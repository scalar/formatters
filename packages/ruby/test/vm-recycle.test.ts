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
// So it asserts two cheaper things instead: that the VM is actually replaced,
// repeatedly, and that linear memory stays bounded while it happens. Both fail
// on the same regression, both fail sooner, and neither costs what reaching a
// wall does. The first is the one with teeth - one sample formatted over and
// over reuses its own freed pages and plateaus, so the bound alone would stay
// green with the recycle deleted.
//
// Every format here passes `rubocop: false`. The recycling being guarded is the
// VM's, and it is identical either way - but the RuboCop pass costs two to three
// times as much per format, which took this file from ~15s to ~150s against a
// 300s hang guard. That is a hang guard with almost no headroom left, on a
// slower runner it is a red build, and none of the cost buys any more coverage
// of the thing under test.

import { format } from '../src/index'
import { nodeVm } from '../src/node-vm'
import { describe, expect, it } from 'bun:test'

// ~37KB, and enough on its own to carry a fresh VM over the 400MB ceiling
// `format()` recycles at: the artifact arrives pre-initialized, so a VM starts
// at ~373MB and one pass takes it to ~395MB.
const SAMPLE = Array.from(
  { length: 400 },
  (_, i) => `def method_${i}(alpha, beta: ${i}, gamma: nil)\n  alpha.map { |x| x * ${i} }.select(&:positive?)\nend`,
).join('\n')

/**
 * Enough passes to recycle several times over. Measured: the VM recycles on
 * every other pass, so ten gives five, which exercises the path repeatedly while
 * leaving the run short enough to sit in the main suite.
 */
const PASSES = 10

/**
 * The bound, and it is a long way clear of the measured peak on purpose.
 *
 * A recycling VM peaks at 406MB here - the ~373MB a pre-initialized VM starts
 * at, plus one pass, caught on the call that trips the ceiling. This number is
 * not sized against that peak: it is sized against the wasm32 2GB wall the
 * recycling exists to keep the VM away from, so that a regression that lets
 * memory climb is caught well before the crash and without this file failing on
 * ordinary variation.
 *
 * Which is also why it is not the only assertion. Formatting *this* sample
 * repeatedly plateaus - with recycling switched off it settles at ~415MB and
 * stops, because the same input reuses the same freed pages - so a bounds check
 * alone would stay green with the recycle deleted. It was already like that
 * before the artifact was pre-initialized; the recycle count below is what
 * actually holds the behaviour in place.
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
    const expected = await format(SAMPLE, { rubocop: false })
    let peak = 0
    let recycles = 0
    let previous = nodeVm.peek()

    for (let pass = 1; pass <= PASSES; pass++) {
      expect(await format(SAMPLE, { rubocop: false }), `diverged on pass ${pass}`).toBe(expected)

      // Read through nodeVm rather than a return value: this is the same cached
      // VM format() just used, so its buffer is the live one being asserted on.
      const booted = await nodeVm.boot()
      peak = Math.max(peak, booted.memory.buffer.byteLength)

      // `recycle()` replaces the record wholesale, so a changed reference *is* a
      // recycle - where a memory reading is only evidence of one.
      if (previous && booted !== previous) recycles++
      previous = booted

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
    // recycle from format() and this is the line that goes red - the bound
    // below would not, because this sample plateaus (see MEMORY_CEILING_BYTES).
    expect(recycles, 'the VM was never replaced, so format() is not recycling it').toBeGreaterThan(1)

    // And the bound recycling exists to keep, which is what goes red if a future
    // input does climb rather than plateau.
    expect(
      peak,
      `linear memory reached ${Math.round(peak / 1_000_000)}MB, so the VM is not being recycled`,
    ).toBeLessThan(MEMORY_CEILING_BYTES)

    // ...and that it stayed correct across every one of them, which is the
    // failure a bounds check on its own would miss.
    expect(await format(SAMPLE, { rubocop: false })).toBe(expected)
    // Above the budget on purpose, so the budget is what fails and says why.
  }, 420_000)
})
