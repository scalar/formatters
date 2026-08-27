// Runs one Ruby formatting measurement, in a process of its own.
//
// `ruby-bench.ts` spawns this once per measurement and reads a single JSON
// object back off stdout. The one-process-per-measurement split is the whole
// point of the file existing separately, and it is not tidiness: booting the VM
// is a once-per-process cost, and formatting leaks the VM's linear memory (see
// packages/ruby/src/format.ts), so whatever runs second in a process is timed
// against a VM the first thing already degraded. Comparing `rubocop: true`
// against `rubocop: false` sequentially in one run reports a difference, but not
// the one you asked for.
//
// Progress goes to stderr and the result goes to stdout, so the parent can pipe
// the result and let progress through to the terminal live - a corpus run is
// minutes long and a silent one is indistinguishable from a hung one.
//
// It measures `src`, not `dist`, which is what the package's own tests mostly do
// as well. Bun transpiles the sources on the way in and the wasm artifact is the
// same file either way, so the difference does not reach any number here.

import { createHash } from 'node:crypto'
import path from 'node:path'

import { compileArtifact } from '../packages/ruby/src/compile-artifact'
import { format } from '../packages/ruby/src/index'
import { nodeVm } from '../packages/ruby/src/node-vm'

/** What the parent asks for. One of these per spawned process. */
export type BenchRequest =
  | { measurement: 'boot'; rubocop: boolean }
  | { measurement: 'recycle'; rounds: number; rubocop: boolean }
  | { measurement: 'corpus'; corpus: string; rubocop: boolean; limit: number | null }

/**
 * What a cold process pays before it has formatted anything useful.
 *
 * Three parts and a warm baseline rather than one number, because the parts move
 * independently and only some of them are worth attacking: `compileMs` is
 * brotli plus `WebAssembly.compile`, `bootMs` is instantiating the VM plus the
 * syntax_tree patches and `ScalarRubyFmt.setup`, and `firstFormatMs` carries
 * RuboCop's config merge over its own `default.yml` when RuboCop is on - which
 * is where most of a cold call with RuboCop goes now that the artifact arrives
 * with both gems already required.
 */
export type BootResult = {
  measurement: 'boot'
  rubocop: boolean
  compileMs: number
  bootMs: number
  firstFormatMs: number
  warmFormatMs: number
  /**
   * The three above, which is what a caller's first `format()` waits for -
   * with the artifact already in the page cache, because the parent reads it
   * before spawning anything. A genuinely cold machine pays several hundred
   * milliseconds more in `compileMs` than this reports.
   */
  coldTotalMs: number
}

/**
 * What one VM recycle costs, measured directly rather than inferred from a
 * corpus run.
 *
 * A recycle is two costs, not one. `recycleMs` is `boot()` again - cheaper than
 * a cold start because the compiled module is still cached - and `reloadMs` is
 * the next format, which pays the per-VM RuboCop config merge over again when
 * RuboCop is on. Subtracting a warm format leaves the overhead.
 */
export type RecycleResult = {
  measurement: 'recycle'
  rounds: number
  rubocop: boolean
  warmFormatMs: number
  /** Median across the rounds, as are the two below. */
  recycleMs: number
  reloadMs: number
  /** `recycleMs + reloadMs - warmFormatMs`, so the reported rows add up. */
  costMs: number
  /**
   * How large the VM being dropped was, so the number can be read against the
   * 400MB ceiling `format()` actually recycles at. See {@link measureRecycle}.
   */
  outgoingMemoryBytes: number
}

/** A file the formatter refused, kept so a corpus run reports it instead of stopping. */
export type CorpusFailure = {
  file: string
  message: string
}

/** Formatting a whole corpus the way a consumer formatting a codebase would. */
export type CorpusResult = {
  measurement: 'corpus'
  rubocop: boolean
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
  /** How many times `format()` dropped the VM and booted a new one. */
  recycles: number
  /**
   * The largest linear memory any single VM reached, sampled between files.
   *
   * Not the process peak, and deliberately not called one: it misses growth
   * within a format, and it never sees the outgoing and incoming VMs that exist
   * together for a moment mid-recycle - which `format.ts` documents as the pair
   * that actually peaks, near 1GB against this 400MB ceiling.
   */
  largestVmMemoryBytes: number
  failures: CorpusFailure[]
  /** Corpus-relative path to sha256 of the formatted output, for the byte-identical check. */
  outputs: Record<string, string>
}

/**
 * Whatever came back over stdout, keyed by the same `measurement` literal the
 * request carries - which is how the parent types a result against the request
 * that asked for it.
 */
export type BenchResult = BootResult | RecycleResult | CorpusResult

/**
 * The source the boot and recycle measurements format.
 *
 * Deliberately tiny. Both measurements are about what booting costs, so the
 * format on the end is there only to force the per-VM work a first format still
 * does - the RuboCop config merge - to happen and be counted. A real file would
 * add its own formatting cost to a
 * number that is supposed to be about the VM, and would make results from two
 * machines with different corpora incomparable.
 */
const SNIPPET = 'x=[1,2,3].map{|n| n*2}\n'

/**
 * Roughly 255KB of Ruby, formatted before each timed recycle purely to grow the
 * VM. See {@link measureRecycle} for why the growth matters.
 *
 * Sized to clear the 400MB ceiling `format()` recycles at in one pass, and
 * deliberately by a margin. Growing in a single format keeps the untimed part of
 * each round short, and the margin is what makes that work on a machine or an
 * artifact whose leak rate is lower than the ~3MB per KB of input `format.ts`
 * records.
 *
 * The margin has a cost worth knowing: a corpus run recycles just after 400MB,
 * while this drops a VM comfortably past it, so the cost it reports is if
 * anything an over-estimate of a real one. `outgoingMemoryBytes` is measured and
 * reported rather than assumed, so how far past is always visible instead of
 * being a number in a comment that can go stale.
 */
const GROWTH_SAMPLE = Array.from(
  { length: 3000 },
  (_, i) => `def method_${i}(alpha, beta: ${i})\n  alpha.map { |x| x * ${i} }.select(&:positive?)\nend`,
).join('\n')

/** How often the corpus measurement reports progress, in files. */
const PROGRESS_EVERY = 25

const sha256 = (data: string): string => createHash('sha256').update(data).digest('hex')

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  const lower = sorted[middle - 1] ?? 0
  const upper = sorted[middle] ?? 0

  return sorted.length % 2 === 0 ? (lower + upper) / 2 : upper
}

/** Times an awaited call, in milliseconds. */
const timed = async <T>(run: () => Promise<T>): Promise<[T, number]> => {
  const startedAt = performance.now()
  const value = await run()

  return [value, performance.now() - startedAt]
}

/**
 * Times a cold process end to end: decompress and compile the artifact, boot the
 * VM, format once, format again.
 *
 * `compileArtifact` is called first and on purpose, even though `boot` would
 * call it anyway. It caches per process, so calling it here moves the
 * decompression and compilation into a number of their own and leaves `bootMs`
 * measuring the VM alone.
 */
const measureBoot = async (rubocop: boolean): Promise<BootResult> => {
  const [, compileMs] = await timed(compileArtifact)
  const [, bootMs] = await timed(nodeVm.boot)
  const [, firstFormatMs] = await timed(() => format(SNIPPET, { rubocop }))
  const [, warmFormatMs] = await timed(() => format(SNIPPET, { rubocop }))

  return {
    measurement: 'boot',
    rubocop,
    compileMs,
    bootMs,
    firstFormatMs,
    warmFormatMs,
    coldTotalMs: compileMs + bootMs + firstFormatMs,
  }
}

/**
 * Times recycling the VM, which is what a long formatting run keeps paying.
 *
 * Two things here are load-bearing, and both are about pricing the recycle a
 * real run performs rather than a cheaper one.
 *
 * The VM is grown past the ceiling first. `format()` only recycles once linear
 * memory passes 400MB, and it holds the outgoing VM alive across the boot of
 * the incoming one, so the allocation happens against a live outgoing buffer
 * rather than against nothing. Recycling a VM that has formatted one
 * 23-byte snippet would measure a recycle no run ever performs. `outgoing` is
 * held here for the same reason, and read afterwards so it cannot be collected
 * early.
 *
 * The first format is thrown away. It pays the cold path, and a recycle never
 * does - the compiled module is cached for the life of the process, so a
 * recycled VM boots from a module already in hand.
 */
const measureRecycle = async (rounds: number, rubocop: boolean): Promise<RecycleResult> => {
  await format(SNIPPET, { rubocop })
  const [, warmFormatMs] = await timed(() => format(SNIPPET, { rubocop }))

  const recycleMs: number[] = []
  const reloadMs: number[] = []
  let outgoingMemoryBytes = 0

  for (let round = 1; round <= rounds; round++) {
    // Grown with `rubocop: false` whatever the measurement is for: only the
    // linear memory matters here and the RuboCop pass costs two to three times
    // as much per format without adding any of it. It does not change what the
    // dropped VM is carrying either - the snippet formats around this one decide
    // that, and they use the measurement's own setting.
    const beforeGrowth = nodeVm.peek()
    await format(GROWTH_SAMPLE, { rubocop: false })

    // The margin here is real but not wide: a pre-initialized VM arrives with
    // RuboCop's heap in it and so starts within ~30MB of the ceiling. If a
    // future artifact closes that gap further, the growth format starts
    // recycling on its own before the timed one, which costs a round its time
    // rather than its correctness - but silently, so it says so.
    if (beforeGrowth && nodeVm.peek() !== beforeGrowth) {
      console.error(`  round ${round}: the growth pass recycled on its own, so this round is slower than it needs`)
    }

    const outgoing = nodeVm.peek()
    const [, recycled] = await timed(nodeVm.recycle)
    const [, reloaded] = await timed(() => format(SNIPPET, { rubocop }))

    outgoingMemoryBytes = Math.max(outgoingMemoryBytes, outgoing?.memory.buffer.byteLength ?? 0)
    recycleMs.push(recycled)
    reloadMs.push(reloaded)
    console.error(`  recycle ${round}/${rounds}: ${Math.round(recycled + reloaded)}ms`)
  }

  const recycle = median(recycleMs)
  const reload = median(reloadMs)

  return {
    measurement: 'recycle',
    rounds,
    rubocop,
    warmFormatMs,
    recycleMs: recycle,
    reloadMs: reload,
    costMs: recycle + reload - warmFormatMs,
    outgoingMemoryBytes,
  }
}

/**
 * Formats every `.rb` file under a directory, in sorted order, the way a
 * consumer formatting a codebase in one process would.
 *
 * Recycles are counted by watching the VM's identity rather than its memory.
 * `peek()` hands back the record `format()` is formatting through, and
 * `recycle()` replaces that record wholesale, so a changed reference *is* a
 * recycle - where a memory reading is only evidence of one, and misses the case
 * where a single large file grows the fresh VM past the reading it replaced.
 *
 * A file that fails is recorded and the run continues. Stopping would throw away
 * the measurement for the sake of one file, and which files a build cannot
 * format is itself worth seeing.
 */
const measureCorpus = async (corpus: string, rubocop: boolean, limit: number | null): Promise<CorpusResult> => {
  const found = [...new Bun.Glob('**/*.rb').scanSync({ cwd: corpus })].sort()
  const files = limit === null ? found : found.slice(0, limit)

  if (files.length === 0) throw new Error(`no .rb files found under ${corpus}`)

  const failures: CorpusFailure[] = []
  const outputs: Record<string, string> = {}
  let bytes = 0
  let totalMs = 0
  let recycles = 0
  let largestVmMemoryBytes = 0
  let previous = nodeVm.peek()

  for (const [index, file] of files.entries()) {
    const source = await Bun.file(path.join(corpus, file)).text()
    const startedAt = performance.now()

    try {
      const formatted = await format(source, { rubocop })

      // Hashed after the clock is read, so the digest is not counted as
      // formatting. It is sub-millisecond either way, but `totalMs` is what
      // `msPerKb` and the recycle share are built on.
      totalMs += performance.now() - startedAt
      bytes += Buffer.byteLength(source)
      outputs[file] = sha256(formatted)
    } catch (error) {
      failures.push({ file, message: error instanceof Error ? error.message : String(error) })
    }

    // `peek()` is undefined only when a boot failed, and then it stays that way
    // until one succeeds. Holding the previous record rather than overwriting it
    // with undefined keeps the eventual re-boot countable as the one transition
    // it is.
    const booted = nodeVm.peek()
    if (booted) {
      if (previous && booted !== previous) recycles++
      previous = booted
      largestVmMemoryBytes = Math.max(largestVmMemoryBytes, booted.memory.buffer.byteLength)
    }

    if ((index + 1) % PROGRESS_EVERY === 0 || index + 1 === files.length) {
      console.error(`  ${index + 1}/${files.length} files, ${Math.round(totalMs / 1000)}s, ${recycles} recycles`)
    }
  }

  return {
    measurement: 'corpus',
    rubocop,
    files: files.length,
    bytes,
    totalMs,
    msPerKb: bytes === 0 ? 0 : totalMs / (bytes / 1024),
    recycles,
    largestVmMemoryBytes,
    failures,
    outputs,
  }
}

const run = (request: BenchRequest): Promise<BenchResult> => {
  switch (request.measurement) {
    case 'boot':
      return measureBoot(request.rubocop)
    case 'recycle':
      return measureRecycle(request.rounds, request.rubocop)
    case 'corpus':
      return measureCorpus(request.corpus, request.rubocop, request.limit)
  }
}

const raw = process.argv[2]
if (!raw) throw new Error('ruby-bench-measure expects a JSON request as its only argument')

const request: BenchRequest = JSON.parse(raw)

process.stdout.write(JSON.stringify(await run(request)))
