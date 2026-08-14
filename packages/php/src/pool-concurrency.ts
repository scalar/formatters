import { hostLimits } from './host-limits'

/**
 * How many PHP instances a batch of this size should be spread across.
 *
 * PHP CS Fixer fixes one file at a time and a wasm PHP instance is a single
 * thread, so a batch's cost is simply the sum of its files. Splitting it across
 * instances is the only way to make that sum smaller in wall-clock terms, and it
 * costs nothing in output: the fixer never looks at more than the file in front
 * of it, so a file formats to the same bytes whichever instance formats it.
 *
 * The default is deliberately conservative. Formatting is something a build does
 * on the way to its real work, and a formatter that takes a container down by
 * helping itself to every core and a gigabyte of memory is worse than a slow
 * one. Callers who know their own budget can say so with `concurrency`.
 */

/**
 * Even on a large, unconstrained machine the default stops here. Beyond about
 * four instances the memory grows faster than the speedup on the batch sizes
 * this is for, and a formatter is rarely the only thing running.
 */
const DEFAULT_MAX_INSTANCES = 4

/**
 * A child process costs about 400ms to start and boot PHP, which is worth
 * roughly four files. Requiring eight before adding an instance keeps the split
 * profitable rather than break-even, and keeps small batches on the single warm
 * instance the process already has.
 */
const MIN_FILES_PER_INSTANCE = 8

/**
 * What one instance costs resident, measured with the fixer's classes
 * autoloaded: around 220MB, rounded up for the process around it.
 */
const INSTANCE_BYTES = 250 * 1024 * 1024

/**
 * The share of the memory limit the pool will spend. The rest is for whatever
 * else the process is doing - in a codegen pipeline, usually holding the sources
 * being formatted and the ones already emitted.
 */
const MEMORY_HEADROOM = 0.6

export const poolConcurrency = (fileCount: number, requested?: number): number => {
  if (requested !== undefined) {
    if (!Number.isInteger(requested) || requested < 1) {
      throw new TypeError(`concurrency must be a positive integer, received ${requested}`)
    }

    // Trust a caller who names a number - they know their container better than
    // any heuristic here does - but never boot an instance with no file for it.
    return Math.max(1, Math.min(requested, fileCount))
  }

  const { cpus, memoryBytes } = hostLimits()

  return Math.max(
    1,
    Math.min(
      DEFAULT_MAX_INSTANCES,
      cpus,
      Math.floor(fileCount / MIN_FILES_PER_INSTANCE),
      Math.floor((memoryBytes * MEMORY_HEADROOM) / INSTANCE_BYTES),
    ),
  )
}
