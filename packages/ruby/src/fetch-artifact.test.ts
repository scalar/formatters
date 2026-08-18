import { createArtifactLoader } from './fetch-artifact'
import { describe, expect, it } from 'bun:test'

/** The smallest valid wasm module, so these tests never reach for the network. */
const wasm = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00])
const module = new WebAssembly.Module(wasm)
const compile = async (): Promise<WebAssembly.Module> => module

describe('fetch-artifact', () => {
  // The documented recovery for a synchronous caller is to `init()` again, so
  // refusing the second call would make the instruction impossible to follow.
  it('allows init to be called again with no options', async () => {
    const loader = createArtifactLoader(compile)
    await loader.init({ bytes: wasm })
    await expect(loader.init()).resolves.toBeUndefined()
  })

  // Re-pointing after the artifact has been read cannot take effect, so it says
  // so rather than appearing to work.
  it('refuses new options once the artifact has been read', async () => {
    const loader = createArtifactLoader(compile)
    await loader.init({ bytes: wasm })
    expect(loader.init({ url: '/somewhere/else' })).rejects.toThrow(/already been read/)
  })
})
