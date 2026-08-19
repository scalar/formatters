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
// is Node 24.15 - see boot-module.ts. On anything older the test skips rather
// than hanging or failing to compile, because that is exactly what the module
// would do there.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { format } from '../dist/index.js'

// Both halves of the floor are version comparisons here, where the runtime
// really is Node: 24 for the optimizer, 24.15 for the exception-handling
// opcodes. boot-module.ts feature-detects the second one instead, because it
// also has to be right under bun.
const [major = 0, minor = 0] = process.versions.node.split('.').map(Number)
const tooOld =
  major < 24 || (major === 24 && minor < 15) ? `needs Node 24.15 or newer, this is ${process.version}` : false

// TeaVM's stderr is wired to console.error, so this collects what the module
// writes there rather than what Node writes. Installed before any formatting,
// because the noise it guards against fired once per process - and `node --test`
// gives this file a process of its own, so nothing else can have spent it.
const printed: string[] = []
const realConsoleError = console.error
if (!tooOld) {
  console.error = (...args: unknown[]) => {
    printed.push(args.map(String).join(' '))
  }
}

test('formats Kotlin under plain Node', { skip: tooOld }, async () => {
  const out = await format('fun  f( ) {\nval x=1\n}')
  assert.equal(out, 'fun f() {\n  val x = 1\n}\n')
})

// V8 and JavaScriptCore reported this differently - four lines under bun, forty
// under Node, where the exception arrives with fake stack frames attached - so
// it is asserted on both. The bun half is packages/kotlin/test/quiet.test.ts.
test('writes nothing to stderr', { skip: tooOld }, async () => {
  // The report was scheduled with setTimeout and landed on the turns after the
  // first format resolved, not during it, so this has to yield before it looks.
  await new Promise((resolve) => setTimeout(resolve, 50))
  await new Promise((resolve) => setTimeout(resolve, 50))
  console.error = realConsoleError

  assert.deepEqual(printed, [])
})

test('reports an unsupported runtime instead of hanging on it', { skip: !tooOld }, async () => {
  await assert.rejects(() => format('class A{}'), /needs Node 24\.15\.0 or newer/)
})
