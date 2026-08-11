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
//
// It is not a formality for this package. bun runs the module on
// JavaScriptCore; only this file exercises it on V8, where the artifact's floor
// is Node 24 - see boot-module.ts. On anything older the test skips rather than
// hangs, because that is exactly what the module would do there.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { format } from '../dist/index.js'

const major = Number.parseInt(process.versions.node, 10)
const tooOld = major < 24 ? `needs Node 24 or newer, this is ${process.version}` : false

test('formats Java under plain Node', { skip: tooOld }, async () => {
  const out = await format('class A{int x  =  1;void f(){g( "hi" );}}')
  assert.equal(out, 'class A {\n  int x = 1;\n\n  void f() {\n    g("hi");\n  }\n}\n')
})

test('reports an unsupported runtime instead of hanging on it', { skip: !tooOld }, async () => {
  await assert.rejects(() => format('class A{}'), /Node 24 or newer/)
})
