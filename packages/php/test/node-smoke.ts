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
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

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

// A sharded batch forks `pool-child.js` out of `dist`, so it fails here in the
// same ways the sync worker can - a file the build did not emit, a specifier
// Node's ESM resolver will not take. It also has to be big enough to actually
// shard: the default keeps anything under eight files in this process.
test('formats a sharded PHP batch under plain Node', async () => {
  const sources = Array.from({ length: 24 }, (_, index) => `<?php\nclass N${index}{\npublic function b(){return 1;}\n}`)

  const results = await format(sources, { concurrency: 3 })

  assert.equal(results.length, 24)
  results.forEach((result, index) => {
    assert.equal(result, `<?php\n\nclass N${index}\n{\n    public function b()\n    {\n        return 1;\n    }\n}\n`)
  })
})

// Same shape through the synchronous entry point, which reaches the pool from a
// worker thread rather than from the main one - children forked from a thread are
// exactly the kind of thing that works until it does not.
test('formats a sharded PHP batch synchronously under plain Node', () => {
  const sources = Array.from({ length: 24 }, () => SOURCE)

  const results = formatSync(sources, { concurrency: 3 })

  assert.equal(results.length, 24)
  for (const result of results) assert.equal(result, EXPECTED)
})

// The two tests above would pass without this one being true. A pool whose child
// entry point is missing from the build falls back to formatting every shard in
// the calling process, which is correct and several times slower - so the only
// symptom is a performance regression no assertion about output can see. Check
// for the file `fork` is going to reach for.
test('ships the child entry point the pool forks', () => {
  const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist')

  assert.ok(fs.existsSync(path.join(dist, 'pool-child.js')), 'dist/pool-child.js is missing, so batches cannot shard')
})
