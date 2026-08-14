import { formatBatch } from './format-batch'
import { formatPool } from './format-pool'
import { describe, expect, it } from 'bun:test'

/**
 * Enough files that the default concurrency forks at least one child - the
 * threshold is eight files per instance - while staying small enough to keep the
 * suite quick.
 */
const sources = Array.from(
  { length: 24 },
  (_, i) => `<?php\nclass Thing${i}{\npublic function value(){return ${i};}\n}`,
)

describe('format-pool', () => {
  // This is the claim the whole thing rests on: PHP CS Fixer never looks past
  // the file in front of it, so splitting a batch across processes may change
  // how long it takes and must not change a single byte.
  it('produces byte-identical output to formatting the batch in one instance', async () => {
    const options = { rules: '@PSR12' }

    expect(await formatPool(sources, options)).toEqual(await formatBatch(sources, options))
  })

  it('returns results in input order across shards', async () => {
    const results = await formatPool(sources, { concurrency: 3 })

    results.forEach((result, index) => {
      expect(result).toContain(`class Thing${index}`)
      expect(result).toContain(`return ${index};`)
    })
  })

  // A shard is formatted in a different process from its neighbours, so a
  // failure has to come back at the position it belongs to rather than taking
  // the batch - or the shard - down with it.
  it('isolates a parse failure to its own position', async () => {
    const withFailures = [...sources]
    withFailures[5] = '<?php class {{{'
    withFailures[19] = '<?php function ('

    const results = await formatPool(withFailures, { concurrency: 3 })

    expect(results[5]).toBeInstanceOf(SyntaxError)
    expect(results[19]).toBeInstanceOf(SyntaxError)
    expect(results[0]).toContain('class Thing0')
    expect(results[23]).toContain('class Thing23')
  })

  // `concurrency: 1` is the path a small batch takes too, so it has to be the
  // same batch formatting it always was - no processes, no reassembly.
  it('formats in the calling process when asked for one instance', async () => {
    const results = await formatPool(sources.slice(0, 3), { concurrency: 1 })

    expect(results[0]).toContain('class Thing0')
    expect(results[2]).toContain('class Thing2')
  })

  it('returns an empty batch without booting anything', async () => {
    expect(await formatPool([])).toEqual([])
  })

  it('carries options through to every shard', async () => {
    const results = await formatPool(sources, { indent: '  ', concurrency: 3 })

    for (const result of results) {
      expect(result).toContain('\n  public function value()')
    }
  })

  // A rejected rule set is a whole-batch failure rather than a per-file one, and
  // every shard hits it. The caller should see the fixer's own message however
  // many processes were involved.
  it('reports a rejected rule from a sharded batch', async () => {
    const results = await formatPool(sources, { rules: 'no_such_rule_exists', concurrency: 3 })

    for (const result of results) {
      expect(result).toBeInstanceOf(Error)
      expect((result as Error).message).toContain('no_such_rule_exists')
    }
  })

  it('does not corrupt UTF-8 on its way through a child process', async () => {
    const utf8 = Array.from({ length: 24 }, (_, i) => `<?php $label${i} = "héllo wörld 🌍 ${i}";`)

    const results = await formatPool(utf8, { concurrency: 3 })

    results.forEach((result, index) => {
      expect(result).toContain(`héllo wörld 🌍 ${index}`)
    })
  })
})
