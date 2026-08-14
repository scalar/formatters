/** One instance's share of a batch, with the positions it came from. */
export type Shard = {
  /** Each source's index in the original batch, so results can be put back in order. */
  indices: number[]
  sources: string[]
}

/**
 * Splits a batch into shards of roughly equal cost.
 *
 * Dealing the files out round-robin would be simpler, but a batch is only as
 * fast as its slowest shard, and formatting cost tracks a file's length closely
 * enough that a shard holding the three biggest files decides the whole batch.
 * So this is longest-processing-time-first: take the files largest first and put
 * each one wherever the least work has landed so far. It is the classic greedy
 * bound - never worse than 4/3 of a perfect split - and for the generated code
 * this exists to format it lands within a few percent.
 */
export const shardSources = (sources: readonly string[], count: number): Shard[] => {
  const shards: Array<Shard & { bytes: number }> = Array.from({ length: Math.max(1, count) }, () => ({
    indices: [],
    sources: [],
    bytes: 0,
  }))

  const byDescendingSize = sources
    .map((source, index) => ({ source, index }))
    .sort((left, right) => right.source.length - left.source.length)

  for (const { source, index } of byDescendingSize) {
    // `reduce` rather than a sort per file: the shard count is tiny, and this
    // keeps the assignment stable for equally loaded shards, which is what makes
    // the split reproducible for a given batch.
    const lightest = shards.reduce((best, shard) => (shard.bytes < best.bytes ? shard : best))

    lightest.indices.push(index)
    lightest.sources.push(source)
    lightest.bytes += source.length
  }

  return shards
    .filter((shard) => shard.sources.length > 0)
    .map(({ indices, sources: shardSources }) => ({
      indices,
      sources: shardSources,
    }))
}
