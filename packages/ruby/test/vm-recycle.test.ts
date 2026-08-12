// Guards the VM recycling in src/format.ts.
//
// Before it existed, formatting past ~680KB of cumulative input killed the
// cached VM: linear memory grew ~74MB per medium file, crossed the wasm32 2GB
// signed-pointer boundary, and the glue threw `RangeError: Start offset -… is
// outside the bounds of the buffer`. Every file formatted fine on its own, so
// the bug only ever showed up in a process that formatted a lot - exactly what
// formatting a whole codebase does.
//
// Slow by nature (it has to actually push through enough input), so it lives in
// its own file rather than padding the main suite.

import { format } from '../src/format'
import { describe, expect, it } from 'bun:test'

// A file big enough that a handful of passes clears the old ceiling several
// times over. Two dozen iterations of this used to be fatal.
const SAMPLE = Array.from(
  { length: 400 },
  (_, i) => `def method_${i}(alpha, beta: ${i}, gamma: nil)\n  alpha.map { |x| x * ${i} }.select(&:positive?)\nend`,
).join('\n')

/**
 * Enough passes of this ~37KB sample to carry more than 1MB of cumulative input
 * through the VM, which is comfortably past the ~680KB wall and is what the
 * assertion at the end of the test pins.
 *
 * No higher than that on purpose. Every pass leaks ~113MB of linear memory that
 * only a recycle can reclaim, so passes are the most expensive thing in this
 * suite - the 40 this used to run took over two minutes on a CI runner and, on
 * a slow one, longer than anybody waited. They also bought nothing the 1MB
 * claim did not already have: at the current ceiling this recycles every third
 * pass, so 27 still exercises the recycle path nine times over.
 */
const PASSES = 27

describe('vm-recycle', () => {
  it('keeps formatting past the memory ceiling that used to crash the VM', async () => {
    const expected = await format(SAMPLE)

    for (const pass of Array.from({ length: PASSES }, (_, index) => index + 1)) {
      expect(await format(SAMPLE), `diverged on pass ${pass}`).toBe(expected)
    }

    expect(Buffer.byteLength(SAMPLE) * (PASSES + 1)).toBeGreaterThan(1_000_000)
  }, 600_000)
})
