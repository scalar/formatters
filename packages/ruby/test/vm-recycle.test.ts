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

/** 40 passes of ~30KB is well over 1MB - comfortably past the ~680KB wall. */
const PASSES = 40

describe('vm-recycle', () => {
  it('keeps formatting past the memory ceiling that used to crash the VM', async () => {
    const expected = await format(SAMPLE)

    for (const pass of Array.from({ length: PASSES }, (_, index) => index + 1)) {
      expect(await format(SAMPLE), `diverged on pass ${pass}`).toBe(expected)
    }

    expect(Buffer.byteLength(SAMPLE) * (PASSES + 1)).toBeGreaterThan(1_000_000)
  }, 600_000)
})
