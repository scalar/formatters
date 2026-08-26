/** What one package's benchmark run reports back to the parent process. */
export type BenchResult = {
  /** Package directory name, e.g. `ruby`. */
  name: string
  /** Milliseconds from import to `init()` resolving, in a process that has done nothing else. */
  bootMs: number
  /**
   * Milliseconds for the first `format()` after boot.
   *
   * Separate from the steady-state number because several packages do real work
   * on the first call that they never repeat - Ruby requires RuboCop, the JIT
   * tiers up, a lazy class initializer runs. A consumer formatting one file pays
   * `bootMs + firstFormatMs`, and that is the number a CLI feels.
   */
  firstFormatMs: number
  /** Files formatted in the steady-state phase. */
  files: number
  /** Total bytes of input formatted in the steady-state phase. */
  bytes: number
  /** Steady-state per-file milliseconds, sorted. */
  medianMs: number
  meanMs: number
  p95Ms: number
  /** Steady-state throughput in kilobytes of input per second. */
  kbPerSecond: number
  /** Wall-clock milliseconds for the whole steady-state phase. */
  totalMs: number
}
