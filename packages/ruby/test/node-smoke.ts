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

// The default pipeline is syntax_tree *and* RuboCop, which means two tools in
// one VM - and the whole premise of this file is that it all works with nothing
// installed but Node. The blank line after the guard clause is the tell: only
// RuboCop adds it.
test('formats Ruby under plain Node', async () => {
  const out = await format('def call(user)\n  return unless user\n  user.name\nend\n')
  assert.equal(out, 'def call(user)\n  return unless user\n\n  user.name\nend\n')
})

test('formats with syntax_tree alone when opted out, under plain Node', async () => {
  const out = await format('class A\n  def initialize(b)\n@b=b\n  end\nend', { rubocop: false })
  assert.equal(out, 'class A\n  def initialize(b)\n    @b = b\n  end\nend\n')
})

// The synchronous entry point matters most to callers whose seams cannot await -
// a code generator that formats each file inside the builder that emits it.
test('formats Ruby synchronously under plain Node, after init', async () => {
  await init()
  assert.equal(
    formatSync('def call(user)\n  return unless user\n  user.name\nend\n'),
    'def call(user)\n  return unless user\n\n  user.name\nend\n',
  )
})
