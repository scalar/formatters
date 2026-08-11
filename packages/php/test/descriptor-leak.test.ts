// Regression test for the file-descriptor leak that killed the runtime after
// roughly 100 formats.
//
// PHP CS Fixer's `Config` constructor calls `ParallelConfigFactory::detect()`,
// whose CPU-core finders shell out through `proc_open`. There are no
// subprocesses in wasm, so each attempt failed and leaked the pipes it had
// opened; `FixCommand` builds a `Config` eagerly, so it happened on every
// format regardless of input. Around the hundredth the guest's descriptor table
// filled and the runtime trapped, after which every later call failed with
// "File descriptor value too large" - an error that names nothing to do with
// the cause. `boot-php.ts` disables those functions so the finders fail before
// opening anything.
//
// The count matters here: it has to clear the ~100 mark by enough that a
// regression cannot hide under it. Formatting is the slow part of this suite,
// so this uses the smallest input that still exercises the whole pipeline.

import { format } from '../src/format'
import { describe, expect, it } from 'bun:test'

const ITERATIONS = 150

describe('descriptor-leak', () => {
  it('survives enough formats to outlast the descriptor table', async () => {
    const source = '<?php\nclass A{\npublic function b(){return 1;}\n}'
    const expected = await format(source)

    for (let iteration = 2; iteration <= ITERATIONS; iteration++) {
      // Asserting inside the loop rather than collecting: a leak surfaces as a
      // throw, and the iteration number is the useful part of the failure.
      expect(await format(source), `diverged on iteration ${iteration}`).toBe(expected)
    }
  }, 120_000)
})
