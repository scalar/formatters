// Pre-initializes the Ruby artifact: takes a wasm module that boots CRuby and
// returns one that has already booted it, with syntax_tree loaded.
//
// usage: bun preinit.ts <in.wasm> <out.wasm>          ($WIZER, $WASM_MERGE override the tools)
//
// Called by build.sh between wasm-opt and the brotli compression. Bun rather
// than node because this imports the package's own TypeScript sources - the
// Ruby that goes into the snapshot is the Ruby the runtime already carries, and
// having the build restate it is exactly the drift this avoids.
//
// ## Why this exists
//
// Booting CRuby is ~1.8s of `ruby-init`, rubygems, /bundle/setup and
// syntax_tree, and formatting leaks the VM's linear memory, so `format()`
// recycles the VM every so often (see `packages/ruby/src/format.ts`) and would
// pay all of it again each time. wizer runs that boot at build time and
// serializes the resulting linear memory back into the module, so the runtime
// instantiates a VM that is already up.
//
// The artifact used to carry RuboCop as well, which was most of the reason this
// step existed: requiring its 698 cop files was another ~8.9s per VM. RuboCop
// now runs as rbcop, a separate wasm module (see build/rbcop_fmt), so this
// snapshot holds syntax_tree alone.
//
// ## The three things that make this more than a flag
//
// **wizer needs a zero-argument export to call, and CRuby exports none that can
// load Ruby code.** `ruby-init` takes a `list<string>`; `rb-eval-string-protect`
// takes a string. So one is added: `makeShimModule` below emits a tiny module
// whose `wizer-initialize` writes the argv into guest memory and calls
// `ruby-init`, and `wasm-merge` fuses it into the artifact.
//
// **The initialization has to go through `ruby-init` specifically.** wizer traps
// if the init function calls an imported function, and `rb-eval-string-protect`
// lifts its return value into a resource handle through the host's
// `canonical_abi` import - so evaluating a string that way is not available
// here. `ruby-init` reaches `ruby_options`, which executes `-r` requires
// itself, and takes nothing but memory. That is why the program below is
// delivered as `-r/work/preinit.rb` rather than as a `-e` script or an eval.
//
// **The snapshot captures the guest's preopen table.** Snapshot with no
// preopened directories and the restored VM cannot see /work, which is where
// every format writes its input. So wizer is given the same directory
// `boot-vm.ts` gives the runtime, under the same name, from the same constant.
//
// A note on failure: wizer does not fail when the guest does. A Ruby error
// inside the snapshotted boot is printed and the snapshot is still written, so
// `verify` at the end boots the result and formats through it. Nothing here is
// allowed to be checked only by the tests that run later.
//
// A note on what gets frozen: everything the boot observed, including the bytes
// CRuby drew from `random_get` to seed its Hash function. That seed is now a
// constant published in an npm tarball rather than something each process
// draws for itself - `"abc".hash` returns the same integer in every process,
// on every machine.
//
// It does not reach the output. Ruby's hashes iterate in insertion order, and
// the corpus comparison CONTRIBUTING.md asks for is what checks that rather
// than assuming it. What it does give up is the reason Ruby randomizes that
// seed at all: hash-flooding becomes precomputable, and this package does parse
// caller-supplied Ruby into hashes on the way through Ripper and
// syntax_tree. The exposure is judged acceptable here - a formatter's input is
// source its caller already chose to format, the pathological case is slow
// rather than unsafe, and the same input is equally slow on the native gems -
// but it is a real property of a pre-initialized artifact and not a detail of
// how it was built.
//
// The other consequence of that seed is that this step is **not byte
// reproducible**. Two runs over the same input wasm, with the same wizer and
// the same program below, produce artifacts that differ in about two thirds of
// their bytes: the seed moves every hash bucket, and the snapshot is a dump of
// the heap those buckets live in. Both behave identically - that is what
// `verify` and the corpus comparison in CONTRIBUTING.md establish - but a
// rebuild cannot be checked by diffing it against the committed bytes, and
// nothing here should be written as though it could.

import { spawnSync } from 'node:child_process'
import { closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { WORK_DIR, createBootVm } from '../../packages/ruby/src/boot-vm'
import { reprint } from '../../packages/ruby/src/format'

const here = path.dirname(fileURLToPath(import.meta.url))

/** Where the program wizer runs is written, inside the directory it maps as /work. */
const PREINIT_GUEST_PATH = `${WORK_DIR}/preinit.rb`

/**
 * The argv `ruby-init` is given, which is `RubyVM.initialize`'s default plus
 * the requires.
 *
 * `ruby.wasm -EUTF-8 … -e_=0` is what @ruby/wasm-wasi passes when nothing asks
 * for anything else, and it is kept exactly: `-e_=0` is a no-op program that
 * exists because `ruby_options` reads stdin without one, and `$0` ends up as
 * "-e" either way, which is what the runtime used to produce.
 *
 * rubygems is required explicitly because Ruby 4.0 stopped loading it during
 * startup. `Gem` is still defined - as a stub - so nothing fails until
 * something touches a real constant, which syntax_tree does on the second line
 * of `formatter.rb`: `Gem::Version.new(RUBY_VERSION)`. The error that came back
 * was `uninitialized constant Gem::Version`, which reads like a broken artifact
 * rather than a missing require.
 *
 * /bundle/setup puts the baked-in gems on the load path. rbwasm writes it when
 * it packages the Gemfile, and nothing else sets $LOAD_PATH up for us.
 */
const RUBY_INIT_ARGV = ['ruby.wasm', '-EUTF-8', '-rrubygems', '-r/bundle/setup', `-r${PREINIT_GUEST_PATH}`, '-e_=0']

/**
 * The Ruby that runs inside the snapshot: syntax_tree, required once so that
 * no VM restored from the snapshot requires it again.
 */
const PREINIT_PROGRAM = `require "syntax_tree"
`

/**
 * Stops, with a reason.
 *
 * Throws rather than calling `process.exit`, which is not interchangeable here:
 * `process.exit` terminates synchronously and `finally` blocks do not run, so
 * every failing build would leave its ~37MB scratch directory behind in the
 * system temp. The catch at the bottom of the file turns this back into an exit
 * code, after the cleanup has happened.
 *
 * Annotated on the binding rather than only on the arrow so TypeScript treats a
 * call as ending control flow.
 */
const fail: (message: string) => never = (message) => {
  throw new Error(message)
}

/** Runs a build tool, failing loudly rather than leaving a half-made artifact behind. */
const run = (label: string, command: string, args: string[], env?: NodeJS.ProcessEnv): string => {
  // Output goes to files rather than pipes, and is read back afterwards. One of these tools is
  // chatty enough that it matters: wasm-merge warns per import it resolves when it fuses the shim,
  // which on a module this size runs to megabytes. A piped `spawnSync` gives up on that with
  // ENOBUFS and reports it in `result.error`, so the build failed claiming wasm-merge "could not be
  // run" while naming a binary that had in fact run and succeeded - and `maxBuffer` does not help,
  // because Bun's `spawnSync` does not honour it. A file has no such ceiling.
  const outPath = path.join(tmpdir(), `scalar-ruby-fmt-${label}-${process.pid}.out`)
  const errPath = path.join(tmpdir(), `scalar-ruby-fmt-${label}-${process.pid}.err`)
  const outFd = openSync(outPath, 'w')
  const errFd = openSync(errPath, 'w')

  let result: ReturnType<typeof spawnSync>
  let stdout = ''
  let stderr = ''
  try {
    result = spawnSync(command, args, { env, stdio: ['ignore', outFd, errFd] })
  } finally {
    closeSync(outFd)
    closeSync(errFd)
    stdout = readFileSync(outPath, 'utf8')
    stderr = readFileSync(errPath, 'utf8')
    rmSync(outPath, { force: true })
    rmSync(errPath, { force: true })
  }

  if (result.error) fail(`${label} could not be run (${command}): ${result.error.message}`)
  if (result.status !== 0) fail(`${label} exited ${String(result.status)}\n${stdout}${stderr}`)

  return `${stdout}${stderr}`
}

/**
 * Emits the WAT for the module that gives wizer something to call.
 *
 * Everything it needs is already exported by the artifact, which is what makes
 * this cheaper than patching CRuby: `cabi_realloc` allocates, `ruby-init` runs
 * `ruby_options`, and the lowering of `func(args: list<string>) -> ()` is a
 * pointer to an array of (pointer, length) pairs plus a count - the same shape
 * @ruby/wasm-wasi's own binding writes from JavaScript.
 *
 * The argv bytes are stored one at a time rather than through a passive data
 * segment. It is a few dozen instructions either way, and `i32.store8` needs no
 * agreement with wizer about which bulk-memory operations it supports.
 *
 * `_initialize` is deliberately *not* called here. wizer runs it itself before
 * the init function - it knows about WASI reactors - and then drops the export,
 * which is also why `boot-vm.ts` calling `wasi.initialize` on the result is a
 * no-op rather than a second round of C constructors.
 */
const makeShimModule = (moduleName: string, argv: string[]): string => {
  const encoder = new TextEncoder()

  // Each argument is NUL-terminated: `ruby_options` wants C strings, and
  // @ruby/wasm-wasi's binding appends the NUL for the same reason.
  const encoded = argv.map((argument) => encoder.encode(`${argument}\0`))
  const totalBytes = encoded.reduce((total, bytes) => total + bytes.length, 0)

  const byteStores: string[] = []
  const entryStores: string[] = []
  let at = 0

  for (const [index, bytes] of encoded.entries()) {
    for (const [offset, byte] of bytes.entries()) {
      byteStores.push(`    (i32.store8 offset=${at + offset} (local.get $argv) (i32.const ${byte}))`)
    }
    entryStores.push(
      `    (i32.store offset=${index * 8} (local.get $list) (i32.add (local.get $argv) (i32.const ${at})))`,
      `    (i32.store offset=${index * 8 + 4} (local.get $list) (i32.const ${bytes.length}))`,
    )
    at += bytes.length
  }

  return `(module
  (import ${JSON.stringify(moduleName)} "memory" (memory 1))
  (import ${JSON.stringify(moduleName)} "cabi_realloc" (func $realloc (param i32 i32 i32 i32) (result i32)))
  (import ${JSON.stringify(moduleName)} "ruby-init: func(args: list<string>) -> ()" (func $ruby_init (param i32 i32)))

  (func (export "wizer-initialize")
    (local $argv i32)
    (local $list i32)

    ;; cabi_realloc(0, 0, align, size) is the canonical ABI's allocate.
    (local.set $argv (call $realloc (i32.const 0) (i32.const 0) (i32.const 1) (i32.const ${totalBytes})))
${byteStores.join('\n')}

    ;; list<string> lowers to a pointer to (pointer, length) pairs, plus a count.
    (local.set $list (call $realloc (i32.const 0) (i32.const 0) (i32.const 4) (i32.const ${encoded.length * 8})))
${entryStores.join('\n')}

    (call $ruby_init (local.get $list) (i32.const ${encoded.length}))
  )
)
`
}

/**
 * Boots the finished artifact and formats through it.
 *
 * The check that matters, and the reason it is here rather than left to the test
 * suite: wizer reports success whether or not the Ruby it ran raised, so an
 * artifact whose `require "syntax_tree"` blew up is written out looking fine.
 * This runs the package's own boot and syntax_tree pass over the bytes just
 * produced, and stops the build instead of committing a broken snapshot.
 */
const verify = async (wasmPath: string): Promise<void> => {
  const bytes = readFileSync(wasmPath)
  const booted = await createBootVm(() => WebAssembly.compile(bytes)).boot()

  const reprinted = reprint(booted, 'x=[1,2].map{|n| n*2}', 80)
  if (reprinted !== 'x = [1, 2].map { |n| n * 2 }\n') {
    fail(`the snapshot's syntax_tree produced ${JSON.stringify(reprinted)}`)
  }

  // RuboCop is not in this artifact any more, and a snapshot that still had it
  // would be ~7MB of dead Ruby heap shipped to every consumer.
  if (booted.vm.eval('defined?(RuboCop) ? "yes" : "no"').toString() !== 'no') {
    fail('the snapshot still has RuboCop loaded; the Layout pass is rbcop now')
  }
}

const [input, output] = process.argv.slice(2)

// Checked before the scratch directory exists, so this one really can exit on
// the spot - there is nothing yet for the `finally` below to clean up.
if (!input || !output) {
  console.error('usage: bun preinit.ts <in.wasm> <out.wasm>')
  process.exit(1)
}

// rbwasm downloads binaryen for its own use and build.sh downloads wizer beside
// it, so both default to that cache and neither has to be on PATH. $WIZER and
// $WASM_MERGE are for running this against a tree those have not been fetched
// into - the same shape build.sh uses for wasm-opt. Give $WIZER an absolute
// path: wizer is run with an environment of exactly HOME, for the reason below,
// and that leaves nothing on PATH to resolve a bare name against.
const wizer = process.env['WIZER'] ?? path.join(here, 'build', 'toolchain', 'wizer', 'wizer')
const wasmMerge = process.env['WASM_MERGE'] ?? path.join(here, 'build', 'toolchain', 'binaryen', 'bin', 'wasm-merge')

const scratch = mkdtempSync(path.join(tmpdir(), 'ruby-fmt-preinit-'))

try {
  // The directory the snapshot's preopen table has to match, laid out as a real
  // one so wizer can map it. It holds only the program being required: the
  // runtime's /work starts empty.
  const workDirectory = path.join(scratch, 'work')

  mkdirSync(workDirectory, { recursive: true })
  writeFileSync(path.join(workDirectory, path.basename(PREINIT_GUEST_PATH)), PREINIT_PROGRAM)

  const shimPath = path.join(scratch, 'wizer-shim.wat')
  const mergedPath = path.join(scratch, 'merged.wasm')
  writeFileSync(shimPath, makeShimModule('ruby', RUBY_INIT_ARGV))

  // The features are the ones the artifact itself uses; binaryen refuses to
  // parse it with any of them off. The merged module is otherwise untouched -
  // wasm-merge resolves the shim's imports against the artifact's exports and
  // changes nothing else.
  console.log('preinit: merging the wizer entry point')
  run('wasm-merge', wasmMerge, [
    // The shim imports the artifact's memory, so the merged module ends up with one - but
    // wasm-merge validates the intermediate, where the import is still a second memory, and
    // refuses without this. It is enabled for the merge, not present in the result: the check
    // below counts the memories in what comes out.
    '--enable-multimemory',
    '--enable-bulk-memory',
    '--enable-nontrapping-float-to-int',
    '--enable-sign-ext',
    '--enable-mutable-globals',
    '--enable-multivalue',
    input,
    'ruby',
    shimPath,
    'shim',
    '-o',
    mergedPath,
  ])

  // `env` is set rather than inherited, and that is the point of passing it at
  // all: Ruby reads ENV once, during `ruby-init`, so whatever the build machine
  // happens to have exported would be baked into every VM a consumer boots.
  // HOME is the one variable the runtime sets: `Dir.home` raises rather than
  // falling back without it, and rubygems asks for it while it loads.
  console.log('preinit: snapshotting the initialized VM')
  const wizerOutput = run(
    'wizer',
    wizer,
    [
      '--allow-wasi',
      '--wasm-bulk-memory',
      'true',
      '--inherit-env',
      'true',
      '--init-func',
      'wizer-initialize',
      '--mapdir',
      `${WORK_DIR}::${workDirectory}`,
      '-o',
      output,
      mergedPath,
    ],
    { HOME: WORK_DIR },
  )

  // A clean run says nothing at all. Anything here is the guest talking, and the
  // guest only talks when something went wrong - wizer itself exits 0 either way.
  if (wizerOutput.trim()) fail(`the snapshotted boot wrote output, so something in it failed:\n${wizerOutput}`)

  console.log('preinit: verifying the snapshot formats')
  await verify(output)

  const before = statSync(input).size
  const after = statSync(output).size
  console.log(`preinit: ${(before / 1024 ** 2).toFixed(1)}MB -> ${(after / 1024 ** 2).toFixed(1)}MB uncompressed`)
} catch (error) {
  console.error(`preinit: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
