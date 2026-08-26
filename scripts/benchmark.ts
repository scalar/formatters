// Benchmarks every package against the native tool it is a compile of.
//
// Run it with `bun run bench`. Nothing here is part of a published package -
// this is a measuring instrument, not a feature.
//
// ## What it measures, and why those two numbers
//
// Formatting through one of these packages costs two very different things, and
// a single number hides which one a complaint is about:
//
//   1. **Cold start** - one file, one process, nothing warmed up. This is what a
//      pre-commit hook, a `npx`-style one-shot, or a CI step that formats a
//      single file pays. On the wasm side it is Node's own startup plus reading,
//      decompressing and instantiating a language runtime. On the native side it
//      is process startup plus whatever the tool loads (a JVM, a gem, a phar).
//   2. **Steady state** - one more file through a process that has already
//      booted. This is what a watcher, a language server, or a formatting run
//      over a whole repository pays for every file after the first.
//
// The native side is measured the same two ways, so the comparison is like for
// like: one CLI invocation per file for the cold number, and the *marginal* cost
// of one more file inside a single invocation for the steady-state number.
// Marginal rather than averaged, because averaging a batch over its file count
// smears the tool's own startup across the files and flatters it.
//
// ## What it does not measure
//
// Output. Whether these packages agree with the tools they are compiled from is
// the conformance tests' job, and they assert it - this only asserts that both
// sides produced *something*, so that a formatter that silently gave up cannot
// post a good time.

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { type Timing, formatMs, formatRatio, summarize } from './benchmark/measure'
import { type ResolvedNative, type SampleSize, TARGETS, type Target, isMissing } from './benchmark/targets'

const root = path.join(import.meta.dir, '..')
const samplesDir = path.join(import.meta.dir, 'benchmark', 'samples')

/** How the run was configured, so a printed table can say what produced it. */
type Options = {
  targets: readonly Target[]
  sizes: readonly SampleSize[]
  steadyRuns: number
  coldRuns: number
  batch: number
  json: string | undefined
  markdown: string | undefined
  skipNative: boolean
}

/** Everything measured for one package at one input size. */
type Result = {
  target: string
  packageName: string
  tool: string
  size: SampleSize
  sourceBytes: number
  sourceLines: number
  wasm:
    | {
        importMs: number
        bootMs: number | undefined
        firstFormatMs: number
        steady: Timing
        groupPerFileMs: number | undefined
        coldProcess: Timing
      }
    | { error: string }
  native:
    | {
        version: string
        coldProcess: Timing
        batch: Timing
        marginalMs: number
      }
    | { unavailable: string }
    | undefined
}

const parseOptions = (argv: readonly string[]): Options => {
  const flag = (name: string): string | undefined => {
    const at = argv.indexOf(`--${name}`)
    return at < 0 ? undefined : argv[at + 1]
  }
  const positional = argv.filter((entry, index) => !entry.startsWith('--') && !argv[index - 1]?.startsWith('--'))

  const requested = positional.length > 0 ? positional : TARGETS.map((target) => target.id)
  const targets = requested.map((id) => {
    const target = TARGETS.find((candidate) => candidate.id === id)
    if (!target) throw new Error(`unknown target: ${id} (have ${TARGETS.map((entry) => entry.id).join(', ')})`)
    return target
  })

  const size = flag('size') ?? 'both'
  const sizes = size === 'both' ? (['small', 'real'] satisfies SampleSize[]) : [size as SampleSize]

  return {
    targets,
    sizes,
    steadyRuns: Number(flag('runs') ?? 10),
    coldRuns: Number(flag('cold-runs') ?? 5),
    batch: Number(flag('batch') ?? 10),
    json: flag('json'),
    markdown: flag('markdown'),
    skipNative: argv.includes('--skip-native'),
  }
}

const options = parseOptions(process.argv.slice(2))

/** A scratch directory for this run. Everything the harness writes lives under it. */
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'scalar-bench-'))

/** The Node that runs the packages. Overridable so a run can compare Node versions. */
const nodeBinary = process.env['NODE'] ?? 'node'

const sampleFile = (target: Target, size: SampleSize): string => path.join(samplesDir, size, target.sample[size])

/**
 * Measures the package in a child process, and the cold one-file case by timing
 * child processes from the outside.
 *
 * The two are separate children on purpose. The in-process numbers need a
 * process that stays alive; the cold number needs one that does not.
 */
const measureWasm = (target: Target, size: SampleSize): Result['wasm'] => {
  const entry = path.join(root, 'packages', target.packageDir, 'dist', 'index.js')
  if (!fs.existsSync(entry)) return { error: `${path.relative(root, entry)} is missing - run bun run build first` }

  const requestFile = path.join(scratch, `${target.id}-${size}-request.json`)
  const resultFile = path.join(scratch, `${target.id}-${size}-result.json`)

  fs.writeFileSync(
    requestFile,
    JSON.stringify({
      entry,
      sourceFile: sampleFile(target, size),
      options: target.formatOptions ?? {},
      initOptions: target.initOptions ?? {},
      runs: options.steadyRuns,
      warmup: 1,
      group: target.groupFormat ? options.batch : 0,
      resultFile,
    }),
  )

  const child = spawnSync(nodeBinary, [path.join(import.meta.dir, 'benchmark', 'measure-package.ts'), requestFile], {
    encoding: 'utf8',
    // Generous, because a cold Ruby VM with RuboCop in it is the slowest thing
    // here by an order of magnitude and a timeout would report as a crash.
    timeout: 10 * 60 * 1000,
  })

  if (child.status !== 0) {
    return {
      error: `measuring ${target.id} failed: ${(child.stderr || child.stdout || '').trim().split('\n').slice(-4).join(' / ')}`,
    }
  }

  const measured = JSON.parse(fs.readFileSync(resultFile, 'utf8')) as {
    importMs: number
    bootMs: number | undefined
    firstFormatMs: number
    steady: Timing
    groupPerFileMs: number | undefined
    formattedBytes: number
  }

  if (measured.formattedBytes === 0) return { error: `${target.id} formatted the sample to nothing` }

  // The cold case gets its own copy of the sample, because `format-once` writes
  // its result back and the samples in the repo are inputs, not scratch space.
  const coldSource = path.join(scratch, `${target.id}-${size}-cold.${target.extension}`)
  const original = fs.readFileSync(sampleFile(target, size), 'utf8')
  const coldSamples: number[] = []

  for (let run = 0; run < options.coldRuns; run += 1) {
    fs.writeFileSync(coldSource, original)
    const started = performance.now()
    const once = spawnSync(
      nodeBinary,
      [
        path.join(import.meta.dir, 'benchmark', 'format-once.ts'),
        entry,
        coldSource,
        JSON.stringify(target.formatOptions ?? {}),
      ],
      { encoding: 'utf8', timeout: 10 * 60 * 1000 },
    )
    const elapsed = performance.now() - started
    if (once.status !== 0)
      return { error: `cold run failed: ${(once.stderr || '').trim().split('\n').slice(-3).join(' / ')}` }
    coldSamples.push(elapsed)
  }

  return {
    importMs: measured.importMs,
    bootMs: measured.bootMs,
    firstFormatMs: measured.firstFormatMs,
    steady: measured.steady,
    groupPerFileMs: measured.groupPerFileMs,
    coldProcess: summarize(coldSamples),
  }
}

/**
 * Times the native tool over `count` copies of the sample, `runs` times.
 *
 * The files are rewritten from the original before every timed run. These tools
 * format in place, so without that the second run would be formatting
 * already-formatted input - which is not the work being measured.
 */
const timeNative = (
  target: Target,
  native: ResolvedNative,
  source: string,
  count: number,
  runs: number,
  label: string,
): Timing => {
  const workspace = fs.mkdtempSync(path.join(scratch, `${target.id}-${label}-`))
  const sourceDir = path.join(workspace, 'src')
  fs.mkdirSync(sourceDir)
  native.prepare?.(workspace)

  const files = Array.from({ length: count }, (_, index) =>
    path.join(sourceDir, `sample_${String(index).padStart(3, '0')}.${target.extension}`),
  )

  const samples: number[] = []
  for (let run = 0; run < runs; run += 1) {
    for (const file of files) fs.writeFileSync(file, source)
    const started = performance.now()
    native.run(workspace, files)
    samples.push(performance.now() - started)
  }

  // A CLI that exits zero without touching its input would post a very good
  // time, so this checks there is still something there. The runners throw on a
  // non-zero exit already; this is the other half of that.
  for (const file of files) {
    if (fs.readFileSync(file, 'utf8').trim().length === 0) {
      throw new Error(`${target.id}: the native tool emptied ${path.basename(file)}`)
    }
  }

  return summarize(samples)
}

const measureNative = (target: Target, size: SampleSize): Result['native'] => {
  if (options.skipNative) return undefined

  const resolution = target.resolveNative()
  if (isMissing(resolution)) return resolution

  const source = fs.readFileSync(sampleFile(target, size), 'utf8')
  const coldProcess = timeNative(target, resolution, source, 1, options.coldRuns, `${size}-cold`)
  const batch = timeNative(target, resolution, source, options.batch, options.coldRuns, `${size}-batch`)

  // The marginal cost of one more file inside an invocation that is already
  // running: what the batch cost, minus what one file cost, over the files that
  // difference bought. This is the number that belongs next to a warmed-up
  // `format()` call, because neither one is paying for startup.
  // Clamped at zero: where a tool's per-file work is small next to its startup,
  // run-to-run noise can make the batch look cheaper than the single file, and a
  // negative cost is not a thing. It reads as "too small to separate from noise",
  // which is the honest reading.
  const marginalMs = Math.max(0, (batch.median - coldProcess.median) / Math.max(1, options.batch - 1))

  return { version: resolution.version, coldProcess, batch, marginalMs }
}

const results: Result[] = []

for (const target of options.targets) {
  for (const size of options.sizes) {
    const file = sampleFile(target, size)
    const source = fs.readFileSync(file, 'utf8')
    process.stderr.write(`measuring ${target.id} (${size}, ${source.split('\n').length} lines)\n`)

    results.push({
      target: target.id,
      packageName: target.packageName,
      tool: target.tool,
      size,
      sourceBytes: source.length,
      sourceLines: source.split('\n').length,
      wasm: measureWasm(target, size),
      native: measureNative(target, size),
    })
  }
}

/**
 * What an empty Node process costs, measured the same way the cold rows are.
 *
 * Every cold-start number below includes Node starting up and stripping the
 * types off a one-file entry point. That is real - a user pays it too - but it
 * is not the formatter, so it is measured once and printed, and a reader who
 * wants the formatter's share alone can subtract it.
 */
const nodeStartupMs = (): number => {
  const samples: number[] = []
  for (let run = 0; run < Math.max(3, options.coldRuns); run += 1) {
    const started = performance.now()
    spawnSync(nodeBinary, [path.join(import.meta.dir, 'benchmark', 'noop.ts')], { encoding: 'utf8' })
    samples.push(performance.now() - started)
  }
  return summarize(samples).median
}

/** `node -v` and friends, so a table is attributable to a machine. */
const environment = (): Record<string, string> => {
  const version = (file: string, args: string[]): string => {
    const result = spawnSync(file, args, { encoding: 'utf8' })
    return (result.stdout ?? '').trim().split('\n')[0] ?? 'unknown'
  }

  return {
    date: new Date().toISOString().slice(0, 10),
    platform: `${os.type()} ${os.release()} ${os.arch()}`,
    cpu: `${os.cpus()[0]?.model ?? 'unknown'} x${os.cpus().length}`,
    memory: `${Math.round(os.totalmem() / 1024 ** 3)}GB`,
    node: version(nodeBinary, ['-v']),
    bun: version('bun', ['-v']),
    'empty node process': formatMs(nodeStartupMs()),
  }
}

/** Measured once: the probes cost real time, and two tables quoting different numbers would be worse. */
const env = environment()

const cell = (value: string | undefined): string => value ?? '-'

/** `4.3x slower` / `2.1x faster`, from the wasm side's point of view. */
const comparison = (wasmMs: number | undefined, nativeMs: number | undefined): string => {
  if (wasmMs === undefined || nativeMs === undefined || nativeMs <= 0) return '-'
  const ratio = wasmMs / nativeMs
  return ratio >= 1 ? `${formatRatio(wasmMs, nativeMs)} slower` : `${formatRatio(nativeMs, wasmMs)} faster`
}

const renderMarkdown = (): string => {
  const lines: string[] = []

  lines.push('# Formatting benchmarks')
  lines.push('')
  lines.push(`Every package against the native tool it is a compile of, measured on ${env['date']}.`)
  lines.push('')
  lines.push('Generated by `bun run bench` - see [`scripts/benchmark/README.md`](scripts/benchmark/README.md)')
  lines.push('for what each row needs and how the numbers are taken. Two of them carry most of the')
  lines.push('meaning:')
  lines.push('')
  lines.push('- **Cold start** is one file in one process, nothing warmed up - a pre-commit hook, a')
  lines.push("  one-shot CLI. Both sides pay their own startup, and the wasm side pays Node's too.")
  lines.push('- **Steady state** is one more file through a process that is already up. The native')
  lines.push('  side is the *marginal* cost of one more file inside a single invocation, so neither')
  lines.push('  side is paying for startup in that row.')
  lines.push('')
  lines.push('| | |')
  lines.push('|---|---|')
  for (const [key, value] of Object.entries(env)) lines.push(`| ${key} | ${value} |`)
  lines.push(`| runs | ${options.coldRuns} cold, ${options.steadyRuns} steady-state, batches of ${options.batch} |`)
  lines.push('')

  for (const size of options.sizes) {
    const rows = results.filter((result) => result.size === size)
    if (rows.length === 0) continue

    const first = rows[0]
    lines.push(`## ${size === 'small' ? 'A small file' : 'A real file'}`)
    lines.push('')
    lines.push(
      size === 'small'
        ? `Roughly ${first ? first.sourceLines : 0} lines - a snippet, where startup is nearly all of the cost.`
        : 'Roughly 150 lines of ordinary application code, which is what most files in a repository look like.',
    )
    lines.push('')
    lines.push('### Cold start: one file, one process')
    lines.push('')
    lines.push('| language | tool | `@scalar/*` on Node | native CLI | difference |')
    lines.push('|---|---|---|---|---|')

    for (const row of rows) {
      const wasmCold = 'error' in row.wasm ? undefined : row.wasm.coldProcess.median
      const nativeCold = row.native && !('unavailable' in row.native) ? row.native.coldProcess.median : undefined
      lines.push(
        `| ${row.target} | ${row.tool} | ${cell(wasmCold === undefined ? undefined : formatMs(wasmCold))} | ${cell(nativeCold === undefined ? undefined : formatMs(nativeCold))} | ${comparison(wasmCold, nativeCold)} |`,
      )
    }

    lines.push('')
    lines.push('### Steady state: one more file in a process that is already up')
    lines.push('')
    lines.push('| language | `@scalar/*` median | p95 | native marginal | difference |')
    lines.push('|---|---|---|---|---|')

    for (const row of rows) {
      const steady = 'error' in row.wasm ? undefined : row.wasm.steady
      const marginal = row.native && !('unavailable' in row.native) ? row.native.marginalMs : undefined
      lines.push(
        `| ${row.target} | ${cell(steady && formatMs(steady.median))} | ${cell(steady && formatMs(steady.p95))} | ${cell(marginal === undefined ? undefined : formatMs(marginal))} | ${comparison(steady?.median, marginal)} |`,
      )
    }

    const grouped = rows.filter((row) => !('error' in row.wasm) && row.wasm.groupPerFileMs !== undefined)
    if (grouped.length > 0) {
      lines.push('')
      lines.push('### Formatting a group in one call')
      lines.push('')
      lines.push('Packages whose `format` also takes an array, against the same per-file numbers.')
      lines.push('')
      lines.push('| language | one call per file | one call for the group | native marginal |')
      lines.push('|---|---|---|---|')
      for (const row of grouped) {
        if ('error' in row.wasm) continue
        const marginal = row.native && !('unavailable' in row.native) ? row.native.marginalMs : undefined
        lines.push(
          `| ${row.target} | ${formatMs(row.wasm.steady.median)} | ${cell(row.wasm.groupPerFileMs === undefined ? undefined : formatMs(row.wasm.groupPerFileMs))} | ${cell(marginal === undefined ? undefined : formatMs(marginal))} |`,
        )
      }
    }

    lines.push('')
    lines.push('### Where the cold time goes')
    lines.push('')
    lines.push('| language | import | init() | first format | steady format |')
    lines.push('|---|---|---|---|---|')

    for (const row of rows) {
      if ('error' in row.wasm) {
        lines.push(`| ${row.target} | ${row.wasm.error} | | | |`)
        continue
      }
      lines.push(
        `| ${row.target} | ${formatMs(row.wasm.importMs)} | ${row.wasm.bootMs === undefined ? 'no init export' : formatMs(row.wasm.bootMs)} | ${formatMs(row.wasm.firstFormatMs)} | ${formatMs(row.wasm.steady.median)} |`,
      )
    }
    lines.push('')
  }

  const notes = options.targets.filter((target) => target.note !== undefined)
  if (notes.length > 0) {
    lines.push('## Notes')
    lines.push('')
    for (const target of notes) lines.push(`- **${target.id}**: ${target.note}`)
    lines.push('')
  }

  const versions = results.filter((row) => row.native && !('unavailable' in row.native))
  if (versions.length > 0) {
    lines.push('## What the native side was')
    lines.push('')
    for (const row of [...new Map(versions.map((entry) => [entry.target, entry])).values()]) {
      const native = row.native
      if (!native || 'unavailable' in native) continue
      lines.push(`- **${row.target}**: ${native.version}`)
    }
    lines.push('')
  }

  const skipped = [
    ...new Map(
      results.filter((row) => row.native && 'unavailable' in row.native).map((row) => [row.target, row]),
    ).values(),
  ]
  if (skipped.length > 0) {
    lines.push('## Not measured here')
    lines.push('')
    lines.push('A missing native side is a fact about the machine this ran on, not a gap in the harness.')
    lines.push('')
    for (const row of skipped) {
      const native = row.native
      if (!native || !('unavailable' in native)) continue
      lines.push(`- **${row.target}**: ${native.unavailable}`)
    }
    lines.push('')
  }

  return lines.join('\n')
}

const markdown = renderMarkdown()
process.stdout.write(`\n${markdown}\n`)

if (options.markdown) {
  fs.writeFileSync(path.resolve(options.markdown), `${markdown}\n`)
  process.stderr.write(`\nwrote ${options.markdown}\n`)
}

if (options.json) {
  fs.writeFileSync(
    path.resolve(options.json),
    `${JSON.stringify({ environment: env, options: { ...options, targets: options.targets.map((target) => target.id) }, results }, null, 2)}\n`,
  )
  process.stderr.write(`wrote ${options.json}\n`)
}

fs.rmSync(scratch, { recursive: true, force: true })
