import { createArtifactLoader } from './fetch-artifact'
import type { InitOptions } from './types'
import { describe, expect, it } from 'bun:test'

/** The smallest valid wasm module, so these tests never reach for the network. */
const wasm = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00])
const module = new WebAssembly.Module(wasm)
const compile = async (): Promise<WebAssembly.Module> => module

const loader = (): ReturnType<typeof createArtifactLoader> =>
  createArtifactLoader({ defaultUrl: () => new URL('https://example.invalid/a.wasm.br'), compile })

describe('fetch-artifact', () => {
  // `init` is the documented way to warm the browser build, and calling it
  // twice has to stay harmless.
  it('allows init to be called again with no options', async () => {
    const one = loader()
    await one.init({ bytes: wasm })
    await expect(one.init()).resolves.toBeUndefined()
  })

  // Re-pointing after the artifact has been read cannot take effect, so it says
  // so rather than appearing to work.
  it('refuses new options once the artifact has been read', async () => {
    const one = loader()
    await one.init({ bytes: wasm })
    await expect(one.init({ url: '/somewhere/else' })).rejects.toThrow(/already been read/)
  })

  // A fetch cannot be waited on synchronously, so the synchronous view of the
  // module is empty until the asynchronous one has filled it.
  it('answers compileSync only once the module has compiled', async () => {
    const one = loader()
    expect(one.source.compileSync()).toBeUndefined()

    await one.init({ bytes: wasm })

    expect(one.source.compileSync()).toBe(module)
  })

  // The options used to describe two artifacts, with this one under `rbcop`.
  // That shape is refused by name, before anything is fetched.
  it('refuses the old two-artifact init options', async () => {
    const legacy = { rbcop: { url: '/assets/rbcop_fmt.wasm.br' } } as InitOptions

    await expect(loader().init(legacy)).rejects.toThrow(/no longer takes an `rbcop` option/)
  })
})
