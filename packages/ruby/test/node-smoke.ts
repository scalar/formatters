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

const SOURCE = 'def call(user)\n  return unless user\n  user.name\nend\n'
const EXPECTED = 'def call(user)\n  return unless user\n\n  user.name\nend\n'

// First, and on purpose: under Node booting is synchronous, so a fresh process
// can format without awaiting anything at all. The blank line after the guard
// clause is Layout/EmptyLineAfterGuardClause, so it is RuboCop's pass that ran.
test('formats Ruby synchronously under plain Node, with no init', () => {
  assert.equal(formatSync(SOURCE), EXPECTED)
})

test('formats Ruby under plain Node', async () => {
  assert.equal(await format(SOURCE), EXPECTED)
})

test('accepts init as a harmless no-op under plain Node', async () => {
  await init()
  assert.equal(
    formatSync('class A\n  def initialize(b)\n@b=b\n  end\nend'),
    'class A\n  def initialize(b)\n    @b = b\n  end\nend\n',
  )
})
