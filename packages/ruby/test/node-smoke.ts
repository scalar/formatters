// Runs under plain Node (`bun run test:node`), not bun.
//
// The rest of the suite runs on bun against the TypeScript sources, but every
// package here promises to work with nothing installed but Node - that is the
// whole premise of the repo. So this file loads the *built* package from
// `dist`, which is exactly what a consumer gets, using only node: built-ins.
//
// It is TypeScript, and no build step turns it into JavaScript first: Node
// strips the types itself, unflagged since 22.18 and 23.6. So `node --test` is
// still running this file directly, with no bundler and no bun in the process -
// which is the only property that makes this test worth anything.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { format, formatSync, init } from '../dist/index.js'

test('formats Ruby under plain Node', async () => {
  const out = await format('class A\n  def initialize(b)\n@b=b\n  end\nend')
  assert.equal(out, 'class A\n  def initialize(b)\n    @b = b\n  end\nend\n')
})

// The synchronous entry point matters most to callers whose seams cannot await -
// a code generator that formats each file inside the builder that emits it.
test('formats Ruby synchronously under plain Node, after init', async () => {
  await init()
  assert.equal(
    formatSync('class A\n  def initialize(b)\n@b=b\n  end\nend'),
    'class A\n  def initialize(b)\n    @b = b\n  end\nend\n',
  )
})
