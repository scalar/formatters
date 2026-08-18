import { createBootModule } from './boot-module'
import { compileArtifact } from './compile-artifact'
import { describe, expect, it } from 'bun:test'

describe('boot-module', () => {
  // `boot` hands back a cached promise, `peek` hands back the live instance, and
  // `recycle` replaces the instance after a trap. If it replaced only one of the
  // two, the synchronous path would recover onto a fresh instance while the
  // asynchronous one kept resolving to the one we had just declared dead - and
  // nothing downstream would notice, because a trapped instance often still
  // formats. So the invariant is asserted here rather than through `format`.
  it('points both the sync and the async path at the replacement after a recycle', async () => {
    const { boot, peek, recycle } = createBootModule(compileArtifact)
    const first = await boot()

    const replaced = recycle()
    if (!replaced) throw new Error('recycle produced no instance, which this environment should allow')
    expect(replaced).not.toBe(first)

    expect(peek()).toBe(replaced)
    expect(await boot()).toBe(replaced)
  })

  it('boots again after a failed boot rather than caching the rejection', async () => {
    let attempts = 0
    const { boot } = createBootModule(async () => {
      attempts += 1
      if (attempts === 1) throw new Error('transient')
      return compileArtifact()
    })

    expect(boot()).rejects.toThrow('transient')
    await Promise.resolve()

    // The second call has to do real work rather than await the dead promise.
    expect(await boot()).toBeDefined()
    expect(attempts).toBe(2)
  })
})
