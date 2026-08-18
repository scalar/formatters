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
// It earns its place for this package in particular. The runtime is loaded by
// dynamic import of a file outside `dist`, and its assets are served from a
// compressed archive through a resource loader rather than read off disk -
// neither of which a bun-only test would prove works on the runtime consumers
// actually use.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { format, formatSync, init } from '../dist/index.js'

test('formats C# under plain Node', async () => {
  const out = await format('using B;using A;class A{int x  =  1;void F(){G( "hi" );}}')
  assert.equal(
    out,
    'using A;\nusing B;\n\nclass A\n{\n    int x = 1;\n\n    void F()\n    {\n        G("hi");\n    }\n}\n',
  )
})

test('reports a parse failure as an error under plain Node', async () => {
  await assert.rejects(() => format('class A{'), /CS1513/)
})

// The synchronous entry point matters most to callers whose seams cannot await -
// a code generator that formats each file inside the builder that emits it.
test('formats C# synchronously under plain Node, after init', async () => {
  await init()
  assert.equal(formatSync('class A{int x=1;}'), 'class A\n{\n    int x = 1;\n}\n')
})
