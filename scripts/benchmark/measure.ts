// Timing primitives shared by the benchmark harness.
//
// Everything here works in milliseconds, from `performance.now()`, and reports
// the *median* rather than the mean. These measurements have a long right tail -
// a GC pause, a wasm memory growth, a cold page fault - and one of those moves a
// mean far more than it moves the experience being measured. The maximum is kept
// alongside it precisely so the tail is visible rather than averaged away.

/** A set of timings for one repeated measurement, in milliseconds. */
export type Timing = {
  /** How many samples went into this. */
  runs: number
  /** The typical case. */
  median: number
  /** The best case, which is roughly the cost with nothing else going on. */
  min: number
  /** The worst case. A large gap to the median means something periodic is happening. */
  max: number
  /** The 95th percentile, which is what a user notices when it is bad. */
  p95: number
}

/** Runs `body` once and returns how long it took, in milliseconds. */
export const timed = async (body: () => Promise<void> | void): Promise<number> => {
  const started = performance.now()
  await body()
  return performance.now() - started
}

/**
 * Runs `body` `runs` times after `warmup` untimed runs, and summarises it.
 *
 * The warmup exists because the first call through any of these packages pays
 * for something the rest do not - a lazily required library inside the guest, a
 * JIT tier-up in the host - and that cost is reported on its own rather than
 * smeared across the steady-state number.
 */
export const repeat = async (runs: number, warmup: number, body: () => Promise<void> | void): Promise<Timing> => {
  for (let index = 0; index < warmup; index += 1) await body()

  const samples: number[] = []
  for (let index = 0; index < runs; index += 1) samples.push(await timed(body))

  return summarize(samples)
}

/** Summarises raw millisecond samples. Throws on an empty set rather than inventing a zero. */
export const summarize = (samples: readonly number[]): Timing => {
  if (samples.length === 0) throw new Error('cannot summarize an empty set of samples')

  const sorted = [...samples].sort((left, right) => left - right)
  const at = (fraction: number): number =>
    sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))] ?? 0

  return {
    runs: sorted.length,
    median: at(0.5),
    min: sorted[0] ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
    p95: at(0.95),
  }
}

/** `1234.5` -> `1.23s`, `12.345` -> `12.3ms`. Kept short enough to sit in a table cell. */
export const formatMs = (milliseconds: number): string => {
  if (milliseconds >= 1000) return `${(milliseconds / 1000).toFixed(2)}s`
  if (milliseconds >= 10) return `${milliseconds.toFixed(0)}ms`
  return `${milliseconds.toFixed(1)}ms`
}

/** `3.4x` - how many times `numerator` is of `denominator`, or `-` when either is missing. */
export const formatRatio = (numerator: number | undefined, denominator: number | undefined): string => {
  if (numerator === undefined || denominator === undefined || denominator === 0) return '-'
  return `${(numerator / denominator).toFixed(1)}x`
}
