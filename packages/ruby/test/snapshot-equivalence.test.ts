// Proves the boot snapshot is an optimisation and nothing else.
//
// The snapshot restores an image of a booted VM instead of booting one, which
// is only ever acceptable if the two VMs format identically. So this boots both
// - one from the image, one the long way - and runs the same sources through
// them, asserting the bytes match. A divergence here means the image is not the
// VM it claims to be, which is the one failure mode this technique has.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { createBootVm } from '../src/boot-vm'
import { compileArtifact } from '../src/compile-artifact'
import { createFormat } from '../src/format'
import { readSnapshot } from '../src/read-snapshot'
import { describe, expect, it } from 'bun:test'

const here = path.dirname(fileURLToPath(import.meta.url))

/**
 * Sources covering the constructs the two passes actually disagree about -
 * multiline chains, heredocs, hash alignment, rescue bodies, pattern matching.
 * Not a corpus: a corpus lives in `bench/`, is gitignored, and cannot be a test
 * fixture. These are the shapes that would expose a half-restored VM.
 */
const SAMPLES: Record<string, string> = {
  chains: `result = collection.map { |item| item.value }
  .select { |value| value > 10 }
     .reduce(0) { |sum, value| sum + value }
`,
  hashes: `CONFIG = {
  name: "example",
      version:   "1.0",
  nested: { deep: true,   deeper: [1,2,3] },
}
`,
  heredoc: `def report(name)
  <<~TEXT
    name: #{name}
      indented
  TEXT
end
`,
  rescue: `def call
    risky
  rescue ArgumentError => error
      warn error.message
  ensure
   cleanup
  end
`,
  patterns: `case value
in { status: "ok", body: }
  body
in [first, *rest] if first.positive?
  rest
else
  nil
end
`,
  classes: `module Outer
    class Inner < Base
    include Mixin
  attr_reader :one,
    :two

      def initialize(one, two = {}, *rest, **options, &block)
      super()
        @one = one
    end
  end
end
`,
}

/** A formatter over a VM that was told there is no snapshot to restore. */
const withoutSnapshot = createFormat(createBootVm(compileArtifact))

/** A formatter over a VM restored from the committed snapshot. */
const withSnapshot = createFormat(createBootVm(compileArtifact, readSnapshot))

const snapshotExists = fs.existsSync(path.join(here, '..', 'ruby_fmt.snapshot.br'))

describe('snapshot-equivalence', () => {
  it.skipIf(!snapshotExists)('the snapshot is the artifact it was built against', async () => {
    expect(await readSnapshot()).toBeDefined()
  })

  it.skipIf(!snapshotExists)(
    'formats identically whether or not the snapshot is used',
    async () => {
      for (const [name, source] of Object.entries(SAMPLES)) {
        const restored = await withSnapshot.format(source)
        const booted = await withoutSnapshot.format(source)
        expect(`${name}:\n${restored}`).toBe(`${name}:\n${booted}`)
      }
    },
    300_000,
  )

  it.skipIf(!snapshotExists)(
    'honours a caller config the snapshot never saw',
    async () => {
      // The snapshot ships with the default config already parsed and cached
      // under a reserved filename. A caller config has to get its own, or it
      // would be answered with the default's settings - this is that guarantee.
      const options = { rubocopConfig: { 'Layout/IndentationWidth': { Width: 4 } } }

      const restored = await withSnapshot.format(SAMPLES['classes'] as string, options)
      const booted = await withoutSnapshot.format(SAMPLES['classes'] as string, options)

      expect(restored).toBe(booted)
      expect(restored).not.toBe(await withSnapshot.format(SAMPLES['classes'] as string))
    },
    300_000,
  )

  it.skipIf(!snapshotExists)(
    'still formats with rubocop turned off',
    async () => {
      const restored = await withSnapshot.format(SAMPLES['chains'] as string, { rubocop: false })
      const booted = await withoutSnapshot.format(SAMPLES['chains'] as string, { rubocop: false })

      expect(restored).toBe(booted)
    },
    300_000,
  )
})
