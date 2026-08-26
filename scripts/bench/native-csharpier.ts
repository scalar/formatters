// Compares @scalar/csharp-fmt against native CSharpier on the same files.
//
// The package's own benchmark (`bun run bench csharp`) answers "how much does
// this package cost", which is the right question when the alternative is
// another package in this repo. It is the wrong question here: the alternative
// to a C# formatter that runs on Node is the real `csharpier` binary running on
// .NET, and that binary has costs of its own - a process to start, a JIT to
// warm - that a resident wasm module does not pay twice.
//
// So this measures total wall-clock to format N files, four ways:
//
//   native one-shot   `csharpier format <files>`, a fresh process each time.
//                     What a shell script or a pre-commit hook pays.
//   native warm       `csharpier server`, already started and already warmed,
//                     driven over its HTTP endpoint. What an editor pays.
//   package one-shot  a fresh `node` process that imports the package, boots it
//                     and formats. The same shape as the native one-shot: shell
//                     to done, startup included.
//   package warm      an already-booted module formatting N files. The same
//                     shape as the native warm path.
//
// Native `csharpier format` walks its inputs across every core; the package is
// single-threaded, so the 169-file one-shot comparison is 4 cores against 1 on
// this machine. That is not a handicap to correct for - it is what the two
// tools really do - but it is why the per-file gap narrows as N grows.
//
// Skips cleanly when no native `csharpier` is on PATH, like the conformance
// tests do, so a toolchain-free checkout still runs it.
//
// Usage:
//   bun run scripts/bench/native-csharpier.ts                  # 1, 10, all
//   bun run scripts/bench/native-csharpier.ts --reps 5         # more repetitions
//   bun run scripts/bench/native-csharpier.ts --counts 1,25,50 # find the crossover
//   bun run scripts/bench/native-csharpier.ts --json

import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { corpusFor } from './corpus'

const root = path.join(import.meta.dir, '..', '..')

const argv = process.argv.slice(2)
const json = argv.includes('--json')
const repsFlag = argv.indexOf('--reps')
const reps = repsFlag === -1 ? 3 : Number(argv[repsFlag + 1] ?? 3)

/** File counts to measure. The default brackets the crossover rather than finding it. */
const countsFlag = argv.indexOf('--counts')
const requestedCounts =
  countsFlag === -1
    ? undefined
    : (argv[countsFlag + 1] ?? '')
        .split(',')
        .map(Number)
        .filter((count) => count > 0)

/** Where the corpus files are copied before a run that writes them back in place. */
const scratch = mkdtempSync(path.join(tmpdir(), 'csharp-native-bench-'))

const corpus = corpusFor('csharp')
if (corpus.length === 0) {
  console.error('no C# corpus in bench/corpus/csharp - run scripts/bench/fetch-corpus.sh first')
  process.exit(1)
}

const version = spawnSync('csharpier', ['--version'], { encoding: 'utf8' })
if (version.status !== 0) {
  console.error('no native csharpier on PATH, skipped')
  process.exit(0)
}
const nativeVersion = version.stdout.trim()

/** Milliseconds, median of `reps` runs, so one scheduling hiccup does not decide a row. */
const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b)
  return Math.round((sorted[Math.floor(sorted.length / 2)] ?? 0) * 10) / 10
}

/**
 * Writes N corpus files into a fresh directory.
 *
 * Both one-shot paths format in place, so every timed run needs its own copy -
 * otherwise the second run formats already-formatted files, which is a
 * different amount of work than the first one did.
 */
const stage = (count: number, label: string): { dir: string; files: string[] } => {
  const dir = path.join(scratch, label)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const files = usable.slice(0, count).map((file) => {
    const target = path.join(dir, file.name.replaceAll('/', '__'))
    writeFileSync(target, file.source)
    return target
  })
  return { dir, files }
}

/**
 * Wall-clock milliseconds for one child process, start to exit.
 *
 * `stdin` is closed rather than piped because `csharpier format` reads source
 * from stdin when it sees input redirected, and an open pipe that never carries
 * anything is redirected input as far as it can tell - it waits forever.
 */
const timeProcess = (command: string, args: string[]): number => {
  const start = performance.now()
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  })
  const elapsed = performance.now() - start
  if (result.status !== 0) {
    console.error(`${command} ${args.slice(0, 3).join(' ')} … exited ${result.status}\n${result.stderr}`)
  }
  return elapsed
}

/**
 * The package's one-shot path, as a shell caller experiences it.
 *
 * Run under `node` rather than bun on purpose: bun is this repo's toolchain and
 * never a runtime requirement, so the number a consumer sees is the Node one.
 * The script is written out rather than passed with `-e` so that the import
 * specifier resolves against a real file next to nothing else.
 */
const packageOneShot = (files: string[]): number => {
  const script = path.join(scratch, 'one-shot.mjs')
  writeFileSync(
    script,
    [
      "import { readFileSync, writeFileSync } from 'node:fs'",
      `import { format } from '${path.join(root, 'packages', 'csharp', 'dist', 'index.js')}'`,
      'for (const file of process.argv.slice(2)) {',
      "  writeFileSync(file, await format(readFileSync(file, 'utf8')))",
      '}',
    ].join('\n'),
  )
  return timeProcess('node', [script, ...files])
}

/** Starts `csharpier server`, waits for it to say which port it took, and warms it. */
const startServer = async (): Promise<{ port: number; stop: () => void; startupMs: number }> => {
  const start = performance.now()
  const child = spawn('csharpier', ['server'], { stdio: ['ignore', 'pipe', 'inherit'] })

  const port = await new Promise<number>((resolve, reject) => {
    let seen = ''
    child.stdout.on('data', (chunk: Buffer) => {
      seen += chunk.toString('utf8')
      const match = seen.match(/Started on (\d+)/)
      if (match?.[1]) resolve(Number(match[1]))
    })
    child.on('exit', (code) => reject(new Error(`csharpier server exited ${code}`)))
  })

  const startupMs = performance.now() - start
  return { port, startupMs, stop: () => child.kill() }
}

/**
 * One format over the server's HTTP endpoint.
 *
 * The file name has to be an absolute path even though nothing is read from
 * disk: the server derives the directory it searches for `.csharpierrc` and
 * `.editorconfig` from it, and throws on a bare name. Pointing it at the OS temp
 * directory - where this repo keeps no config - is what makes this a
 * defaults-to-defaults comparison, the same trick the conformance test uses.
 *
 * `127.0.0.1` rather than `localhost` because the server's `HttpListener` binds
 * IPv4 and a `localhost` that resolves to `::1` gets an HTML 404 back.
 */
const serverFormat = async (port: number, name: string, contents: string): Promise<string> => {
  const response = await fetch(`http://127.0.0.1:${port}/format`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fileName: path.join(tmpdir(), name), fileContents: contents }),
  })
  const body = (await response.json()) as { formattedFile: string; status: string; errorMessage: string | null }
  if (body.status !== 'Formatted') throw new Error(`${name}: ${body.status} ${body.errorMessage ?? ''}`)
  return body.formattedFile
}

type Row = {
  files: number
  nativeOneShotMs: number
  nativeOneShotSkipValidationMs: number
  nativeWarmMs: number
  packageOneShotMs: number
  packageWarmMs: number
}

const server = await startServer()

// The warm path means warm: both sides get a format in before anything is timed,
// so neither is charged for a JIT tier-up the other already paid for.
await serverFormat(server.port, 'warmup.cs', 'class Warmup { }')

const { format, init } = (await import(path.join(root, 'packages', 'csharp', 'dist', 'index.js'))) as {
  format: (source: string) => Promise<string>
  init: () => Promise<void>
}
await init()
await format('class Warmup { }')

// One corpus file is CSharpier's own benchmark fixture, whose contents are C#
// source escaped inside C# string literals - neither side can parse it, and
// timing a throw is not timing a format. Both tools reject exactly the same
// files, so filtering with one of them filters for both.
const usable: typeof corpus = []
for (const file of corpus) {
  try {
    await format(file.source)
    usable.push(file)
  } catch {
    console.error(`  excluded ${file.name}: does not parse`)
  }
}

const counts = (requestedCounts ?? [1, 10, usable.length]).map((count) => Math.min(count, usable.length))

const rows: Row[] = []

for (const count of counts) {
  const nativeOneShot: number[] = []
  const nativeSkip: number[] = []
  const packageOneShotTimes: number[] = []
  const nativeWarm: number[] = []
  const packageWarm: number[] = []

  for (let rep = 0; rep < reps; rep++) {
    // Progress goes to stderr so `--json` stays one clean object on stdout, and
    // so a run that stalls says which phase it stalled in.
    console.error(`  ${count} file(s), rep ${rep + 1}/${reps}`)
    const shared = ['--no-cache', '--no-msbuild-check', '--log-level', 'None']

    const a = stage(count, `native-${count}-${rep}`)
    nativeOneShot.push(timeProcess('csharpier', ['format', ...shared, ...a.files]))

    const b = stage(count, `native-skip-${count}-${rep}`)
    nativeSkip.push(timeProcess('csharpier', ['format', ...shared, '--skip-validation', ...b.files]))

    const c = stage(count, `package-${count}-${rep}`)
    packageOneShotTimes.push(packageOneShot(c.files))

    const slice = usable.slice(0, count)

    const warmNativeStart = performance.now()
    for (const file of slice) await serverFormat(server.port, file.name.replaceAll('/', '__'), file.source)
    nativeWarm.push(performance.now() - warmNativeStart)

    const warmPackageStart = performance.now()
    for (const file of slice) await format(file.source)
    packageWarm.push(performance.now() - warmPackageStart)
  }

  rows.push({
    files: count,
    nativeOneShotMs: median(nativeOneShot),
    nativeOneShotSkipValidationMs: median(nativeSkip),
    nativeWarmMs: median(nativeWarm),
    packageOneShotMs: median(packageOneShotTimes),
    packageWarmMs: median(packageWarm),
  })
}

server.stop()
rmSync(scratch, { recursive: true, force: true })

if (json) {
  console.log(JSON.stringify({ nativeVersion, serverStartupMs: Math.round(server.startupMs), reps, rows }, null, 2))
} else {
  console.log(`native csharpier ${nativeVersion}, server startup ${Math.round(server.startupMs)}ms, median of ${reps}`)
  console.log('')
  console.log('files  native 1-shot  native 1-shot -sv  native warm  package 1-shot  package warm')
  console.log('-----  -------------  -----------------  -----------  --------------  ------------')
  for (const row of rows) {
    console.log(
      String(row.files).padStart(5),
      `${row.nativeOneShotMs}ms`.padStart(14),
      `${row.nativeOneShotSkipValidationMs}ms`.padStart(18),
      `${row.nativeWarmMs}ms`.padStart(12),
      `${row.packageOneShotMs}ms`.padStart(15),
      `${row.packageWarmMs}ms`.padStart(13),
    )
  }
}
