import { shardSources } from './shard-sources'
import { describe, expect, it } from 'bun:test'

describe('shard-sources', () => {
  // Losing or duplicating a source would silently corrupt a caller's batch, so
  // this is the property that matters most.
  it('places every source exactly once, with the index it came from', () => {
    const sources = Array.from({ length: 25 }, (_, i) => `<?php $v${i} = ${'x'.repeat(i * 3)};`)

    const shards = shardSources(sources, 4)
    const pairs = shards.flatMap((shard) => shard.indices.map((index, position) => [index, shard.sources[position]]))

    expect(pairs).toHaveLength(sources.length)
    expect(new Set(pairs.map(([index]) => index)).size).toBe(sources.length)

    for (const [index, source] of pairs) {
      expect(source).toBe(sources[index as number])
    }
  })

  it('never returns more shards than asked for', () => {
    expect(shardSources(['a', 'b', 'c'], 2)).toHaveLength(2)
    expect(shardSources(['a', 'b', 'c'], 3)).toHaveLength(3)
  })

  // More shards than sources would mean booting a PHP instance to format
  // nothing, so the empty ones are dropped rather than returned.
  it('drops shards it has nothing to put in', () => {
    expect(shardSources(['a', 'b'], 8)).toHaveLength(2)
    expect(shardSources([], 4)).toHaveLength(0)
  })

  // A batch takes as long as its slowest shard, and cost tracks length closely
  // enough that dealing the files out in order would hand one shard every big
  // file. Largest-first keeps the shards within a few percent of each other.
  it('balances by size rather than by count', () => {
    const sources = ['x'.repeat(1000), 'x'.repeat(900), 'x'.repeat(100), 'x'.repeat(80), 'x'.repeat(50)]

    const weights = shardSources(sources, 2).map((shard) =>
      shard.sources.reduce((total, source) => total + source.length, 0),
    )

    // A round-robin split would have been 1150 against 980; largest-first gets
    // the two big files apart, which is what makes the difference.
    expect(Math.max(...weights) - Math.min(...weights)).toBeLessThan(250)
  })

  it('returns a single shard holding the whole batch when asked for one', () => {
    const shards = shardSources(['a', 'b', 'c'], 1)

    expect(shards).toHaveLength(1)
    expect(shards[0]?.sources).toHaveLength(3)
    expect(shards[0]?.indices.toSorted((a, b) => a - b)).toEqual([0, 1, 2])
  })
})
