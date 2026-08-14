// Guards the VM recycling in src/format.ts.
//
// Before it existed, formatting past ~680KB of cumulative input killed the
// cached VM: linear memory grew ~74MB per medium file, crossed the wasm32 2GB
// signed-pointer boundary, and the glue threw `RangeError: Start offset -… is
// outside the bounds of the buffer`. Every file formatted fine on its own, so
// the bug only ever showed up in a process that formatted a lot - exactly what
// formatting a whole codebase does.
//
// This used to reach for that wall directly, formatting 1MB of input in the
// hope of falling over if recycling stopped happening. That made it far and away
// the most expensive test in the suite - 90s on a CI runner, and twice it wedged
// long enough to burn the job's whole 30-minute budget without reporting
// anything - and it was a proxy for the invariant rather than the invariant
// itself.
//
// So it asserts the thing recycling is *for* instead: linear memory stays
// bounded no matter how much goes through. That fails on the same regression,
// fails sooner, and reaching a bound costs a fraction of what reaching a wall
// does.

import { bootVm } from '../src/boot-vm'
import { format } from '../src/format'
import { describe, expect, it } from 'bun:test'

// ~37KB. Large enough that a pass moves the memory needle hard (~113MB of
// linear memory that only a recycle reclaims), which is what makes a handful of
// passes enough to tell a recycling VM from a leaking one.
const SAMPLE = Array.from(
  { length: 400 },
  (_, i) => `def method_${i}(alpha, beta: ${i}, gamma: nil)\n  alpha.map { |x| x * ${i} }.select(&:positive?)\nend`,
).join('\n')

/**
 * Enough passes to cross the 400MB recycle ceiling twice over. At ~113MB a pass
 * the VM recycles every fourth one, so ten exercises the path more than once
 * while leaving the run short enough to sit in the main suite.
 */
const PASSES = 10

/**
 * A recycling VM peaks around 543MB here - four passes' growth on top of the
 * 64MB boot, caught on the call that trips the ceiling. A leaking one is at
 * ~1.2GB by the tenth pass and still climbing. 800MB sits in the gap: clear of
 * the real peak by a margin that ordinary variation will not close, and well
 * under where a regression lands on the very pass that introduces it.
 */
const MEMORY_CEILING_BYTES = 800_000_000

/**
 * Fail rather than hang. `vm.eval` is a blocking wasm call and bun's per-test
 * timeout cannot preempt one, so the timeout above only fires between passes -
 * which is exactly where this checks. It turns a run that has gone pathological
 * into a failure that names the pass and the elapsed time, instead of a job
 * that sits silent until CI kills it half an hour later.
 *
 * 300s against a run that takes ~15s, which is a wider margin than it looks
 * like it needs. The per-format costs this used to be sized against - ~6.7s on
 * a runner where local was ~0.34s - were not the runner being slow. They were
 * this file sharing a process with the other six packages' wasm instances,
 * which makes the VM's memory growth about two orders of magnitude slower; the
 * budget fired on exactly that, twice, before the cause was known.
 * scripts/test-packages.ts now gives each package its own process, so the
 * number this guards against is the isolated one. The margin stays wide because
 * the budget is a hang guard, not a performance assertion - it should only ever
 * fire on something pathological, and 300s is still a tenth of the job budget a
 * stall would otherwise burn.
 */
const BUDGET_MS = 300_000

describe('vm-recycle', () => {
  it('keeps linear memory bounded while formatting past the ceiling', async () => {
    const startedAt = performance.now()
    const expected = await format(SAMPLE)
    let peak = 0

    for (let pass = 1; pass <= PASSES; pass++) {
      expect(await format(SAMPLE), `diverged on pass ${pass}`).toBe(expected)

      // Read through bootVm rather than a return value: this is the same cached
      // VM format() just used, so its buffer is the live one being asserted on.
      peak = Math.max(peak, (await bootVm()).memory.buffer.byteLength)

      const elapsed = performance.now() - startedAt
      if (elapsed > BUDGET_MS) {
        throw new Error(
          `vm-recycle exceeded ${BUDGET_MS}ms at pass ${pass} of ${PASSES} (${Math.round(elapsed)}ms). ` +
            `Formatting has become far slower than the ~340ms a pass this expects, so the run was stopped ` +
            `rather than left to hang - the VM or the runner is the place to look, not this assertion.`,
        )
      }
    }

    // The assertion that matters: recycling happened, repeatedly. Delete the
    // recycle from format() and this is the line that goes red.
    expect(
      peak,
      `linear memory reached ${Math.round(peak / 1_000_000)}MB, so the VM is not being recycled`,
    ).toBeLessThan(MEMORY_CEILING_BYTES)

    // ...and that it stayed correct across every one of them, which is the
    // failure a bounds check on its own would miss.
    expect(await format(SAMPLE)).toBe(expected)
    // Above the budget on purpose, so the budget is what fails and says why.
  }, 420_000)
})
