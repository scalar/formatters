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

import { format, formatSync } from '../dist/index.js'

const SOURCE = '<?php\nclass A{\npublic function b(){return 1;}\n}'
const EXPECTED = '<?php\n\nclass A\n{\n    public function b()\n    {\n        return 1;\n    }\n}\n'

test('formats PHP under plain Node', async () => {
  assert.equal(await format(SOURCE), EXPECTED)
})

// `formatSync` loads a second file out of `dist` to run as a worker, so it can
// break in ways the async path cannot - a missing file, or a specifier Node
// will not resolve. Only a real Node run catches that.
test('formats PHP synchronously under plain Node', () => {
  assert.equal(formatSync(SOURCE), EXPECTED)
})

test('formats a PHP batch synchronously under plain Node', () => {
  const results = formatSync([SOURCE, '<?php class {{{', SOURCE])
  assert.equal(results[0], EXPECTED)
  assert.ok(results[1] instanceof SyntaxError)
  assert.equal(results[2], EXPECTED)
})
