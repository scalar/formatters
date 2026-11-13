// Runs one Ruby formatting measurement, in a process of its own.
//
// `ruby-bench.ts` spawns this once per measurement and reads a single JSON
// object back off stdout. One process per measurement because booting is a
// once-per-process cost: a corpus run in the same process as the boot
// measurement would be timed against an instance the boot already warmed, and
// the boot measurement would be timed against nothing cold at all.
//
// Progress goes to stderr and the result goes to stdout, so the parent can pipe
// the result and let progress through to the terminal live - a large corpus
// run takes a while, and a silent one is indistinguishable from a hung one.
//
// It measures `src`, not `dist`, which is what the package's own tests mostly do
// as well. Bun transpiles the sources on the way in and the wasm artifact is the
// same file either way, so the difference does not reach any number here.

import { createHash } from 'node:crypto'
import path from 'node:path'

import { nodeArtifact } from '../packages/ruby/src/compile-artifact'
import { createFormat } from '../packages/ruby/src/format'
import { createRbcop } from '../packages/ruby/src/rbcop'

/** What the parent asks for. One of these per spawned process. */
export type BenchRequest =
  | { measurement: 'boot' }
  | { measurement: 'corpus'; corpus: string; printWidth: number; limit: number | null }

/**
 * What a cold process pays before it has formatted anything useful.
 *
 * Three parts and a warm baseline rather than one number, because the parts move
 * independently: `compileMs` is brotli plus the synchronous compile, `bootMs`
 * is instantiating rbcop, and `firstFormatMs` carries rbcop's config merge over
 * RuboCop's own `default.yml`, which the first format with any given config
 * pays and no later one does.
 */
export type BootResult = {
  measurement: 'boot'
  compileMs: number
  bootMs: number
  firstFormatMs: number
  warmFormatMs: number
  /**
   * The three above, which is what a caller's first `format()` waits for -
   * with the artifact already in the page cache, because the parent reads it
   * before spawning anything.
   */
  coldTotalMs: number
}

/** A file the formatter refused, kept so a corpus run reports it instead of stopping. */
export type CorpusFailure = {
  file: string
  message: string
}

/** Formatting a whole corpus the way a consumer formatting a codebase would. */
export type CorpusResult = {
  measurement: 'corpus'
  printWidth: number
  /** How many files were attempted, failures included. */
  files: number
  /**
   * Input bytes and format time over the files that *succeeded*, and nothing
   * else. A file that throws usually throws early, so folding its size and its
   * few milliseconds into these would quietly drag `msPerKb` down and make a
   * badly broken build look fast.
   */
  bytes: number
  totalMs: number
  msPerKb: number
  /** Median per-file format time, which a few large files cannot drag about. */
  medianMs: number
  /**
   * The process's peak resident set size. The instance's own linear memory
   * plateaus around 11 MB; most of this is the compiled module and the
   * runtime around it.
   */
  peakRssBytes: number
  failures: CorpusFailure[]
  /** Corpus-relative path to sha256 of the formatted output, for the byte-identical check. */
  outputs: Record<string, string>
}

/**
 * Whatever came back over stdout, keyed by the same `measurement` literal the
 * request carries - which is how the parent types a result against the request
 * that asked for it.
 */
export type BenchResult = BootResult | CorpusResult

/**
 * The source the boot measurement formats.
 *
 * Deliberately tiny. The measurement is about what booting costs, so the format
 * on the end is there only to force the config merge a first format does to
 * happen and be counted. A real file would add its own formatting cost to a
 * number that is supposed to be about booting.
 */
const SNIPPET = 'x=[1,2,3].map{|n| n*2}\n'

/** How often the corpus measurement reports progress, in files. */
const PROGRESS_EVERY = 250

const sha256 = (data: string): string => createHash('sha256').update(data).digest('hex')

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  const lower = sorted[middle - 1] ?? 0
  const upper = sorted[middle] ?? 0

  return sorted.length % 2 === 0 ? (lower + upper) / 2 : upper
}

/** Times a call, in milliseconds. */
const timed = async <T>(run: () => T | Promise<T>): Promise<[T, number]> => {
  const startedAt = performance.now()
  const value = await run()

  return [value, performance.now() - startedAt]
}

/**
 * Times a cold process end to end: decompress and compile the artifact,
 * instantiate rbcop, format once, format again.
 *
 * Built from the parts rather than through the package's own `format`, so each
 * step lands in a number of its own. They are the same parts `index.ts` wires.
 */
const measureBoot = async (): Promise<BootResult> => {
  const rbcop = createRbcop(nodeArtifact)
  const { format } = createFormat(rbcop)

  const [, compileMs] = await timed(() => nodeArtifact.compileSync())
  const [, bootMs] = await timed(() => rbcop.bootSync())
  const [, firstFormatMs] = await timed(() => format(SNIPPET))
  const [, warmFormatMs] = await timed(() => format(SNIPPET))

  return {
    measurement: 'boot',
    compileMs,
    bootMs,
    firstFormatMs,
    warmFormatMs,
    coldTotalMs: compileMs + bootMs + firstFormatMs,
  }
}

/**
 * Formats every `.rb` and `.rbi` file under a directory, in sorted order, the
 * way a consumer formatting a codebase in one process would.
 *
 * A file that fails is recorded and the run continues. Stopping would throw away
 * the measurement for the sake of one file, and which files a build cannot
 * format is itself worth seeing.
 */
const measureCorpus = async (corpus: string, printWidth: number, limit: number | null): Promise<CorpusResult> => {
  const found = [...new Bun.Glob('**/*.{rb,rbi}').scanSync({ cwd: corpus })].sort()
  const files = limit === null ? found : found.slice(0, limit)

  if (files.length === 0) throw new Error(`no .rb or .rbi files found under ${corpus}`)

  const { format } = createFormat(createRbcop(nodeArtifact))
  const failures: CorpusFailure[] = []
  const outputs: Record<string, string> = {}
  const times: number[] = []
  let bytes = 0

  for (const [index, file] of files.entries()) {
    const source = await Bun.file(path.join(corpus, file)).text()
    const startedAt = performance.now()

    try {
      const formatted = await format(source, { printWidth })

      // Hashed after the clock is read, so the digest is not counted as
      // formatting. It is sub-millisecond either way, but the time is what
      // `msPerKb` is built on.
      times.push(performance.now() - startedAt)
      bytes += Buffer.byteLength(source)
      outputs[file] = sha256(formatted)
    } catch (error) {
      failures.push({ file, message: error instanceof Error ? error.message : String(error) })
    }

    if ((index + 1) % PROGRESS_EVERY === 0 || index + 1 === files.length) {
      const seconds = times.reduce((sum, ms) => sum + ms, 0) / 1000
      console.error(`  ${index + 1}/${files.length} files, ${seconds.toFixed(1)}s`)
    }
  }

  const totalMs = times.reduce((sum, ms) => sum + ms, 0)

  return {
    measurement: 'corpus',
    printWidth,
    files: files.length,
    bytes,
    totalMs,
    msPerKb: bytes === 0 ? 0 : totalMs / (bytes / 1024),
    medianMs: median(times),
    // `maxRSS` is in kilobytes.
    peakRssBytes: process.resourceUsage().maxRSS * 1024,
    failures,
    outputs,
  }
}

const run = (request: BenchRequest): Promise<BenchResult> => {
  switch (request.measurement) {
    case 'boot':
      return measureBoot()
    case 'corpus':
      return measureCorpus(request.corpus, request.printWidth, request.limit)
  }
}

const raw = process.argv[2]
if (!raw) throw new Error('ruby-bench-measure expects a JSON request as its only argument')

const request: BenchRequest = JSON.parse(raw)

process.stdout.write(JSON.stringify(await run(request)))
