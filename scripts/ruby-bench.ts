// Measures what @scalar/ruby-fmt costs, so a change to it can be argued with
// numbers instead of adjectives.
//
// Ruby is the slowest package here to get going, and by some distance: the
// artifact is the largest in the repo, and instantiating a VM from it is not
// free. What it no longer pays for is loading gems - the artifact is a wizer
// snapshot of a VM with syntax_tree and RuboCop already required into it (see
// build/ruby_fmt/preinit.ts), so neither a cold start nor one of the recycles
// formatting's linear-memory leak forces reads a cop file. The artifact compile
// is the one part a recycle does not repeat either, because the compiled module
// is cached for the life of the process.
//
// Three measurements, each in its own process, because they interfere - booting
// is once per process and formatting leaks, so whatever runs second is timed
// against a VM the first thing already degraded:
//
//   boot     what a cold process pays, with RuboCop and without
//   recycle  what dropping and re-booting the VM costs, timed directly
//   corpus   a whole tree formatted in one process
//
// A corpus run can also write a hash per formatted file. Snapshot before a
// rebuild, snapshot after, `--compare` the two - `--only corpus` on both, since
// the comparison needs neither of the other measurements. That is the corpus
// comparison CONTRIBUTING.md asks for, and `ruby-bench-compare.ts` is what
// refuses to call it a pass when it has not earned one.
//
// `--help` prints the invocations. Bring your own corpus - several MB of real,
// unformatted Ruby in a mix of file sizes. Generated SDK output is ideal because
// that is what consumers put through this package, but any large Ruby codebase
// measures the same thing.

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { accessSync, constants, existsSync, statSync } from 'node:fs'
import path from 'node:path'

import { type Snapshot, compareSnapshots, isRecordOfStrings } from './ruby-bench-compare'
import type { BenchRequest, BenchResult, BootResult, CorpusResult, RecycleResult } from './ruby-bench-measure'

/**
 * The result that goes with a request, so a caller does not have to assert one.
 *
 * Both unions are keyed on the same `measurement` literal, which is what lets
 * this pick the matching half - `measure({ measurement: 'boot', ... })` is typed
 * as returning a {@link BootResult} and nothing else. {@link measure} checks the
 * child's answer against the request, so the correspondence is enforced rather
 * than merely declared.
 */
type ResultFor<R extends BenchRequest> = Extract<BenchResult, { measurement: R['measurement'] }>

/** What the command line asked for, once it has been checked. */
type Options = {
  corpus: string | undefined
  only: string[]
  rubocop: boolean
  limit: number | null
  snapshot: string | undefined
}

/** Every measurement, in the order the report prints them. */
const MEASUREMENTS = ['boot', 'recycle', 'corpus'] as const

/**
 * Flags this accepts, and whether each takes a value. Anything else on the
 * command line is refused: a typo in `--snapshot` used to cost a multi-minute
 * run that then wrote nothing and exited zero.
 */
const FLAGS = new Map<string, 'value' | 'pair' | 'switch'>([
  ['corpus', 'value'],
  ['only', 'value'],
  ['files', 'value'],
  ['snapshot', 'value'],
  ['compare', 'pair'],
  ['no-rubocop', 'switch'],
  ['help', 'switch'],
])

/** How many following arguments each kind of flag consumes. */
const VALUES_TAKEN = { switch: 0, value: 1, pair: 2 }

/**
 * How many recycles the recycle measurement times.
 *
 * Three is enough for a median to mean something and short enough that the
 * measurement stays short - every round grows the VM past the recycle ceiling,
 * drops it and boots a new one from the cached module.
 */
const RECYCLE_ROUNDS = 3

const USAGE = `Usage:
  bun run ruby:bench --corpus <dir> [--only boot,recycle,corpus] [--no-rubocop] [--files <n>] [--snapshot <file>]
  bun run ruby:bench --only boot,recycle
  bun run ruby:bench --only corpus --corpus <dir> --snapshot before.json
  bun run ruby:bench --compare <before.json> <after.json>

  --corpus <dir>      directory of .rb files to format (required by the corpus measurement)
  --only <list>       run a subset of ${MEASUREMENTS.join(',')}
  --no-rubocop        run the recycle and corpus measurements with { rubocop: false }
                      (the boot measurement always reports both, since that is its point)
  --files <n>         format only the first n files of the corpus, for a quick check
  --snapshot <file>   write the corpus run's output hashes here
  --compare <a> <b>   diff two snapshots and exit non-zero if any file differs`

const MEASURE = path.join(import.meta.dir, 'ruby-bench-measure.ts')

const ARTIFACT = path.join(import.meta.dir, '..', 'packages', 'ruby', 'ruby_fmt.wasm.br')

/**
 * Prints why this cannot continue, and stops.
 *
 * Annotated on the binding rather than only on the arrow so that TypeScript
 * treats a call as ending control flow - which is what lets the checks below
 * read as `if (bad) fail(...)` with the good case narrowed afterwards.
 */
const fail: (message: string) => never = (message) => {
  console.error(message)
  process.exit(1)
}

/**
 * Parses the command line, refusing anything it does not recognise.
 *
 * Strict on purpose, and every rule here is one an earlier version got wrong:
 * an unknown flag was ignored, a flag with no value silently meant "the
 * default" - `--only` alone ran all three measurements - a repeated flag
 * silently used the first, and `--corpus --files 3` took `--files` as the
 * directory name. All four cost a long run before anything looked wrong.
 */
const parseArgs = (args: string[]): { compare: [string, string] | undefined; options: Options } => {
  const values = new Map<string, string[]>()

  for (let index = 0; index < args.length; index++) {
    const token = args[index] ?? ''
    if (!token.startsWith('--')) fail(`unexpected argument "${token}". Run --help for the accepted flags.`)

    const name = token.slice(2)
    const kind = FLAGS.get(name)
    if (!kind) {
      // `--corpus=dir` is a common reflex and lands here as one unknown flag,
      // which is a confusing thing to be told when the flag itself is real.
      const hint = token.includes('=') ? ` Values are separated by a space: --${name.split('=')[0]} <value>.` : ''
      fail(`unknown flag "${token}".${hint} Run --help for the accepted flags.`)
    }
    if (values.has(name)) fail(`"${token}" was given more than once`)

    const wanted = VALUES_TAKEN[kind]
    const taken = args.slice(index + 1, index + 1 + wanted)

    // An empty value counts as missing. Every use of these downstream is a
    // truthiness test, so `--snapshot ""` - which is what an unset shell
    // variable expands to - would otherwise read as "not given" while still
    // satisfying the checks that ask whether it was, and a multi-minute run
    // would end having written nothing.
    if (taken.length < wanted || taken.some((value) => value === '' || value.startsWith('--'))) {
      fail(`"${token}" needs ${wanted === 2 ? 'two values' : 'a value'}`)
    }

    values.set(name, taken)
    index += wanted
  }

  const compare = values.get('compare')
  const first = compare?.[0]
  const second = compare?.[1]

  if (first && second) {
    // Comparing does not run anything, so silently ignoring the flags that
    // would have would be a lie about what just happened.
    const ignored = [...values.keys()].filter((name) => name !== 'compare')
    if (ignored.length > 0) fail(`--compare cannot be combined with --${ignored.join(', --')}`)

    return {
      compare: [first, second],
      options: { corpus: undefined, only: [], rubocop: true, limit: null, snapshot: undefined },
    }
  }

  const only = values.get('only')?.[0]?.split(',') ?? [...MEASUREMENTS]
  const unrecognized = only.filter((name) => !MEASUREMENTS.some((measurement) => measurement === name))
  if (unrecognized.length > 0) {
    fail(`unknown measurement(s): "${unrecognized.join('", "')}". Pick from ${MEASUREMENTS.join(', ')}.`)
  }

  // Digits only. `Number` would take `1e3`, `0x10` and ` 7 `, none of which
  // anyone means to type into a `--files` flag.
  const requested = values.get('files')?.[0]
  if (requested !== undefined && !/^[0-9]+$/.test(requested))
    fail(`--files takes a whole number, received "${requested}"`)
  const limit = requested === undefined ? null : Number(requested)
  if (limit !== null && limit < 1) fail('--files takes a number of at least 1')

  const corpus = values.get('corpus')?.[0]
  if (only.includes('corpus') && !corpus) {
    fail('--corpus <dir> is required by the corpus measurement. Use --only boot,recycle to skip it.')
  }

  // Checked here rather than left to the child, which would otherwise report a
  // missing directory as a stack trace wrapped in "the corpus measurement
  // failed".
  if (corpus && !(existsSync(corpus) && statSync(corpus).isDirectory())) {
    fail(`--corpus ${corpus} is not a directory`)
  }

  // Flags that only the corpus measurement reads are refused when it is not
  // going to run, rather than silently dropped.
  const snapshot = values.get('snapshot')?.[0]
  for (const name of ['snapshot', 'corpus', 'files']) {
    if (values.has(name) && !only.includes('corpus')) {
      fail(`--${name} is only read by the corpus measurement, which --only did not select`)
    }
  }

  // The boot measurement reports both columns whatever this says, so on its own
  // the flag would quietly do nothing - and quietly doing nothing is the thing
  // this parser exists to stop.
  if (values.has('no-rubocop') && !only.includes('corpus') && !only.includes('recycle')) {
    fail('--no-rubocop has no effect on the boot measurement, which always reports both columns')
  }

  return {
    compare: undefined,
    options: {
      // Resolved here because the child runs with the repo root as its cwd, so
      // a relative directory would otherwise mean something different to the
      // two processes.
      corpus: corpus === undefined ? undefined : path.resolve(corpus),
      only,
      rubocop: !values.has('no-rubocop'),
      limit,
      snapshot,
    },
  }
}

/**
 * Fails now if the snapshot cannot be written, rather than after the corpus run.
 *
 * `Bun.write` creates missing parent directories but throws on a directory or an
 * unwritable path, and finding that out at the end costs the whole run.
 */
const ensureWritable = (target: string): void => {
  const resolved = path.resolve(target)
  if (existsSync(resolved) && statSync(resolved).isDirectory()) fail(`--snapshot ${target} is a directory`)

  let ancestor = path.dirname(resolved)
  while (!existsSync(ancestor) && ancestor !== path.dirname(ancestor)) ancestor = path.dirname(ancestor)

  // The nearest existing ancestor has to be a directory, not just exist.
  // `--snapshot before.json/after.json` otherwise walks up to a regular file,
  // which is perfectly writable and still makes the write fail with ENOTDIR at
  // the end of the run.
  if (!statSync(ancestor).isDirectory()) fail(`--snapshot ${target} is below ${ancestor}, which is a file`)

  try {
    accessSync(existsSync(resolved) ? resolved : ancestor, constants.W_OK)
  } catch {
    fail(`--snapshot ${target} is not writable`)
  }
}

/**
 * Reads the artifact and hashes it, before anything is timed.
 *
 * Two jobs, one read, and warming the page cache is the reason it happens here
 * rather than inside a measurement. Whichever process touches the artifact
 * first pays for a cold page cache and every process after it does not:
 * measured on one machine at 1,275ms of "artifact compile" in the first child
 * against 387ms in the second, on identical work - and the artifact has since
 * grown, so the gap has not shrunk. That is a gap the size of the thing being
 * measured, sitting on whichever column happens to run first, so the read is
 * pulled out here where it biases nothing.
 *
 * The hash it returns identifies the build a corpus snapshot came from.
 */
const readArtifact = async (): Promise<string> => {
  if (!existsSync(ARTIFACT)) {
    fail(`${ARTIFACT} is missing. It is committed to the repository; build/ruby_fmt/build.sh regenerates it.`)
  }

  return createHash('sha256')
    .update(await Bun.file(ARTIFACT).bytes())
    .digest('hex')
}

const ms = (value: number): string => `${Math.round(value).toLocaleString('en-US')} ms`

const megabytes = (value: number): string => `${Math.round(value / 1_000_000).toLocaleString('en-US')} MB`

const areNumbers = (fields: Record<string, unknown>, keys: string[]): boolean =>
  keys.every((key) => typeof fields[key] === 'number')

/**
 * Whether a value is the `{ file, message }` list a corpus result reports its
 * failures as.
 *
 * Checked down to the elements because they are destructured in the report and
 * mapped into the snapshot. An array of the wrong things passes an `isArray`
 * check and then either throws in the report or writes `null` into a snapshot
 * that the next comparison blames on the operator.
 */
const isFailureList = (value: unknown): boolean =>
  Array.isArray(value) && value.every((entry) => isRecordOfStrings(entry) && 'file' in entry && 'message' in entry)

/**
 * Whether a child's answer carries every field the reports go on to read.
 *
 * Exhaustive over what is read, rather than a spot check on the discriminant.
 * Malformed JSON is already caught by the parse; what gets here instead is a
 * well-formed object missing pieces, and checking only the tag would let that
 * through to print `NaN ms` in four rows and still exit zero. A green run
 * reporting numbers nobody measured is the failure this whole change exists to
 * refuse, so it is refused here too.
 */
const isBenchResult = (value: unknown): value is BenchResult => {
  if (typeof value !== 'object' || value === null) return false
  const fields = value as Record<string, unknown>

  if (fields['measurement'] === 'boot') {
    return areNumbers(fields, ['compileMs', 'bootMs', 'firstFormatMs', 'warmFormatMs', 'coldTotalMs'])
  }

  if (fields['measurement'] === 'recycle') {
    return (
      typeof fields['rubocop'] === 'boolean' &&
      areNumbers(fields, ['rounds', 'warmFormatMs', 'recycleMs', 'reloadMs', 'costMs', 'outgoingMemoryBytes'])
    )
  }

  return (
    fields['measurement'] === 'corpus' &&
    typeof fields['rubocop'] === 'boolean' &&
    areNumbers(fields, ['files', 'bytes', 'totalMs', 'msPerKb', 'recycles', 'largestVmMemoryBytes']) &&
    isFailureList(fields['failures']) &&
    // Checked with the predicate the snapshot reader uses, because this map is
    // what a snapshot's `files` is written from.
    isRecordOfStrings(fields['outputs'])
  )
}

/** One report line: a label, then a column per value. */
const row = (label: string, ...cells: (string | number)[]): void =>
  console.log(label.padEnd(20) + cells.map((cell) => String(cell).padStart(14)).join(''))

/**
 * Runs one measurement in a fresh process and returns what it reported.
 *
 * The child inherits stderr so its progress shows up live, and its stdout - one
 * JSON object, nothing else - is piped back here.
 *
 * `maxBuffer` is lifted because the default is 1MB and a corpus result carries a
 * path and a hash per file, which reaches that around 10,000 files. The child
 * was killed with SIGTERM after finishing the whole multi-minute run, and the
 * parent reported it as `exit null`.
 */
const measure = <R extends BenchRequest>(request: R): ResultFor<R> => {
  const { status, stdout, signal, error } = spawnSync('bun', ['run', MEASURE, JSON.stringify(request)], {
    cwd: path.join(import.meta.dir, '..'),
    stdio: ['ignore', 'pipe', 'inherit'],
    encoding: 'utf8',
    maxBuffer: Infinity,
  })

  if (status !== 0 || !stdout) {
    const cause = error ? `: ${error.message}` : ''
    const how = signal ? `killed by ${signal}` : `exit ${String(status)}`
    fail(`\nthe ${request.measurement} measurement failed (${how})${cause}`)
  }

  // Parsed defensively rather than trusted. Nothing in the package writes to
  // stdout today, so a child that answers with anything but its one JSON object
  // is not a case that happens - but if it ever does, it happens at the end of a
  // run that took minutes, and a stack trace there is a poor way to spend them.
  // This catches malformed JSON; `isBenchResult` catches the well-formed answer
  // that is missing something.
  const parsed: unknown = ((): unknown => {
    try {
      return JSON.parse(stdout)
    } catch {
      return undefined
    }
  })()

  // The tag is what the generic below rests on; the rest is what the reports
  // read. Checking only the tag would leave a truncated result to fail in the
  // report instead, which is the same minutes lost one step later.
  if (!isBenchResult(parsed) || parsed.measurement !== request.measurement) {
    fail(`the ${request.measurement} measurement did not return a usable result`)
  }

  // The check above is what makes this assertion true: TypeScript cannot narrow
  // `Extract<..., { measurement: R['measurement'] }>` from a runtime comparison,
  // however sound the comparison is.
  return parsed as ResultFor<R>
}

const reportBoot = (withRuboCop: BootResult, withoutRuboCop: BootResult): void => {
  console.log('\n=== cold start, one fresh process per column ===\n')
  row('', 'rubocop', 'no rubocop')
  row('artifact compile', ms(withRuboCop.compileMs), ms(withoutRuboCop.compileMs))
  row('VM boot', ms(withRuboCop.bootMs), ms(withoutRuboCop.bootMs))
  row('first format', ms(withRuboCop.firstFormatMs), ms(withoutRuboCop.firstFormatMs))
  row('cold total', ms(withRuboCop.coldTotalMs), ms(withoutRuboCop.coldTotalMs))
  row('warm format', ms(withRuboCop.warmFormatMs), ms(withoutRuboCop.warmFormatMs))

  // The `first format` cells are subtracted rather than the totals: the compile
  // and boot rows do identical work in both columns, so their difference is
  // noise between two processes and folding it in would only blur this. What is
  // left is the per-VM work only a RuboCop run does: merging the config over
  // RuboCop's own `default.yml`, plus the pass over the snippet itself.
  console.log(`\nRuboCop's share of the first format: ${ms(withRuboCop.firstFormatMs - withoutRuboCop.firstFormatMs)}`)
  console.log('cold totals are measured with the artifact already in the page cache')
}

const reportRecycle = (result: RecycleResult): void => {
  console.log(`\n=== VM recycle, RuboCop ${result.rubocop ? 'on' : 'off'} ===\n`)
  row('recycle (boot)', ms(result.recycleMs))
  row('first format after', ms(result.reloadMs))
  row('warm format', ms(result.warmFormatMs))
  row('cost per recycle', ms(result.costMs))
  console.log(
    `\nmedian of ${result.rounds} rounds, dropping a VM grown to at most ${megabytes(result.outgoingMemoryBytes)}`,
  )
}

/**
 * Prints the corpus run, and attributes recycle time when the recycle
 * measurement ran alongside it.
 *
 * Attribution is a multiplication rather than an estimate teased out of the
 * per-file timings, because the recycle measurement already timed the same event
 * directly: it grows a VM past the same ceiling `format()` recycles at and drops
 * it while the outgoing memory is still live. It is still a different process,
 * so the product is an estimate - but of a measured cost rather than a modelled
 * one. The two runs share the `rubocop` setting, without which a recycle's
 * per-VM RuboCop config merge would be priced into a corpus that never ran the
 * RuboCop pass at all.
 */
const reportCorpus = (result: CorpusResult, recycle: RecycleResult | undefined): void => {
  const kilobytes = result.bytes / 1024

  console.log(`\n=== corpus, one process, RuboCop ${result.rubocop ? 'on' : 'off'} ===\n`)
  row('files formatted', (result.files - result.failures.length).toLocaleString('en-US'))
  row('input', `${Math.round(kilobytes).toLocaleString('en-US')} KB`)

  // `format time`, not wall-clock: it is the sum of the `format()` calls, and
  // reading the files off disk is deliberately outside it, because that is this
  // script's cost rather than the package's. It is also the denominator the
  // recycle share below is taken against.
  row('format time', `${(result.totalMs / 1000).toFixed(1)} s`)
  row('per KB', result.bytes === 0 ? 'n/a' : `${result.msPerKb.toFixed(1)} ms`)
  row('recycles', result.recycles)
  row('largest VM', megabytes(result.largestVmMemoryBytes))

  if (recycle && result.recycles > 0) {
    const spent = result.recycles * recycle.costMs
    const share = result.totalMs === 0 ? 0 : (spent / result.totalMs) * 100
    console.log(`\nrecycles cost about ${(spent / 1000).toFixed(1)}s of that, ${share.toFixed(0)}% of the run`)
  }

  if (result.failures.length > 0) {
    console.error(`\n${result.failures.length} of ${result.files} file(s) failed to format:`)
    for (const { file, message } of result.failures.slice(0, 10)) console.error(`  ${file}: ${message}`)
    if (result.failures.length > 10) console.error(`  ... and ${result.failures.length - 10} more`)
  }
}

const args = process.argv.slice(2)

// Bare invocation prints the usage rather than picking a default. Every
// measurement here costs at least a VM boot and the corpus one costs minutes,
// so "what would you like measured" is a better answer than guessing.
if (args.includes('--help') || args.length === 0) {
  console.log(USAGE)
  process.exit(0)
}

const { compare, options } = parseArgs(args)

// A snapshot that is not one is operator error, not a crash, so it reads as the
// one line that says which file and why rather than as a stack trace.
if (compare) {
  await compareSnapshots(compare[0], compare[1]).catch((error: unknown) =>
    fail(error instanceof Error ? error.message : String(error)),
  )
}
if (options.snapshot) ensureWritable(options.snapshot)

const artifact = await readArtifact()

const boot = options.only.includes('boot')
  ? {
      withRuboCop: measure({ measurement: 'boot', rubocop: true }),
      withoutRuboCop: measure({ measurement: 'boot', rubocop: false }),
    }
  : undefined

const recycle = options.only.includes('recycle')
  ? measure({ measurement: 'recycle', rounds: RECYCLE_ROUNDS, rubocop: options.rubocop })
  : undefined

const corpus =
  options.corpus && options.only.includes('corpus')
    ? measure({ measurement: 'corpus', corpus: options.corpus, rubocop: options.rubocop, limit: options.limit })
    : undefined

if (boot) reportBoot(boot.withRuboCop, boot.withoutRuboCop)
if (recycle) reportRecycle(recycle)
if (corpus) reportCorpus(corpus, recycle)

if (options.snapshot && corpus) {
  await Bun.write(
    options.snapshot,
    `${JSON.stringify(
      {
        artifact,
        rubocop: corpus.rubocop,
        files: corpus.outputs,
        failures: corpus.failures.map(({ file }) => file),
      } satisfies Snapshot,
      null,
      2,
    )}\n`,
  )
  console.log(`\nwrote ${Object.keys(corpus.outputs).length} output hashes to ${options.snapshot}`)
}

// A corpus run that could not format everything exits non-zero. Printing the
// failures and exiting green would let a badly broken artifact pass unnoticed in
// anything scripted around this.
//
// The snapshot is written first and on purpose. This is not the gate - a corpus
// with one permanently unformattable file makes both sides of a comparison exit
// non-zero, and `--compare` still passes on it, having said which files it could
// not compare. Withholding the snapshot here would make that comparison
// impossible to reach.
if (corpus && corpus.failures.length > 0) {
  console.error('(a file this build could not format fails this run; a comparison still reports on the rest)')
  process.exit(1)
}
