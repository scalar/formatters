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

// First, and on purpose: under Node booting is synchronous, so a fresh process
// can format without awaiting anything at all.
test('formats Kotlin synchronously under plain Node, with no init', () => {
  assert.equal(formatSync('fun  f( ) {\nval x=1\n}'), 'fun f() {\n  val x = 1\n}\n')
})

test('formats Kotlin under plain Node', async () => {
  assert.equal(await format('class  A  {  }\n', { style: 'kotlinlang' }), 'class A {}\n')
})

test('accepts init as a harmless no-op under plain Node', async () => {
  await init()
  assert.equal(formatSync('fun f(){val xs=listOf(1,2,3)}'), 'fun f() {\n  val xs = listOf(1, 2, 3)\n}\n')
})

// bun runs the module on JavaScriptCore; this is the one place it runs on V8,
// whose call-stack limit is a different number. The trap has to be reported,
// and must cost only the instance it happened in.
test('recovers from source nested past what V8 can follow', async () => {
  const deep = `val x = ${'('.repeat(100_000)}1${')'.repeat(100_000)}`
  await assert.rejects(() => format(deep), /ran out of stack/)
  assert.equal(await format('class A{}'), 'class A {}\n')
})
