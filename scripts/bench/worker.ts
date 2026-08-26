// Benchmarks one package, in a process that has done nothing else.
//
// The parent spawns this per package rather than looping in one process, because
// every package caches its compiled module and booted instance for the life of
// the process. Measuring `boot` twice in one process measures the cache the
// second time, and the packages are not independent even when they are cached -
// see the note in scripts/test-packages.ts about six resident wasm runtimes
// making the Ruby VM's memory growth two orders of magnitude slower.
//
// Everything this prints except the final line goes to stderr, so that a runtime
// that writes to stdout on boot cannot corrupt the JSON the parent reads back.

import path from 'node:path'

import { corpusFor } from './corpus'
import type { BenchResult } from './types'

const [name, ...rest] = process.argv.slice(2)

if (!name) {
  console.error('usage: bun scripts/bench/worker.ts <package> [-- options]')
  process.exit(1)
}

/**
 * How many times the whole corpus is formatted after the warmup pass.
 *
 * One pass is enough for the slower packages and noisy for the faster ones, so
 * this is a floor on total work rather than a fixed count: `--repeat` raises it
 * when a change is small enough to hide inside run-to-run variance.
 */
const repeatFlag = rest.indexOf('--repeat')
const repeat = repeatFlag === -1 ? 1 : Number(rest[repeatFlag + 1] ?? 1)

/** Package options, as JSON, for the packages that take any - e.g. `--options '{"rubocop":false}'`. */
const optionsFlag = rest.indexOf('--options')
const options: Record<string, unknown> = optionsFlag === -1 ? {} : JSON.parse(rest[optionsFlag + 1] ?? '{}')

const corpus = corpusFor(name)
if (corpus.length === 0) {
  console.error(`${name}: no corpus`)
  process.exit(1)
}

type FormatterModule = {
  init: (options?: Record<string, unknown>) => Promise<void>
  format: (source: string, options?: Record<string, unknown>) => Promise<string>
}

const entry = path.join(import.meta.dir, '..', '..', 'packages', name, 'dist', 'index.js')
const mod = (await import(entry)) as FormatterModule

const bootStart = performance.now()
await mod.init(options)
const bootMs = performance.now() - bootStart

// The first format is timed on its own because several packages do work on it
// that they never repeat, and a consumer formatting a single file pays it.
//
// It walks the corpus until one file formats rather than trusting the first,
// because a corpus taken from a real project can start with a fixture that
// project keeps deliberately malformed - and timing a throw is not timing a
// format.
const firstFormatMs = await (async (): Promise<number> => {
  for (const file of corpus) {
    const start = performance.now()
    try {
      await mod.format(file.source, options)
      return performance.now() - start
    } catch {
      // Reported once, by the warmup pass below, which sees the same files.
    }
  }
  return 0
})()

// The warmup pass doubles as the filter. A corpus fetched from a real project
// carries files its own formatter rejects - deliberately malformed fixtures,
// dialects the parser does not accept - and timing a throw is not timing a
// format. Whatever survives this pass is what the measured pass runs, so both
// passes see the same files and the JIT is warm on all of them.
const usable: typeof corpus = []
let rejected = 0

for (const file of corpus) {
  try {
    await mod.format(file.source, options)
    usable.push(file)
  } catch {
    rejected++
  }
}

if (rejected > 0) console.error(`${name}: ${rejected} file(s) the formatter rejects, excluded`)

const durations: number[] = []
let bytes = 0
let failures = 0

const totalStart = performance.now()

for (let pass = 0; pass < repeat; pass++) {
  for (const file of usable) {
    const start = performance.now()
    try {
      await mod.format(file.source, options)
    } catch (error) {
      failures++
      if (failures <= 3) console.error(`${name}: ${file.name} failed: ${String(error)}`)
      continue
    }
    durations.push(performance.now() - start)
    bytes += Buffer.byteLength(file.source)
  }
}

const totalMs = performance.now() - totalStart

if (failures > 0) console.error(`${name}: ${failures} file(s) failed and were excluded`)

const sorted = [...durations].sort((a, b) => a - b)
const at = (fraction: number): number => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0
const round = (value: number): number => Math.round(value * 100) / 100

const result: BenchResult = {
  name,
  bootMs: round(bootMs),
  firstFormatMs: round(firstFormatMs),
  files: durations.length,
  bytes,
  medianMs: round(at(0.5)),
  meanMs: round(durations.reduce((sum, value) => sum + value, 0) / (durations.length || 1)),
  p95Ms: round(at(0.95)),
  kbPerSecond: round(bytes / 1024 / (totalMs / 1000)),
  totalMs: round(totalMs),
}

console.log(JSON.stringify(result))
