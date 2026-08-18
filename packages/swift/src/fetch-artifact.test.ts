import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

import { createArtifactLoader } from './fetch-artifact'
import { describe, expect, it } from 'bun:test'

/** The artifact already expanded, so these tests never reach for the network. */
const wasm = zlib.brotliDecompressSync(fs.readFileSync(path.join(import.meta.dir, '..', 'swift_fmt.wasm.br')))

describe('fetch-artifact', () => {
  // `bytes` is the escape hatch for a caller who already has the artifact, and a
  // caller who has it rarely has it at offset zero of its own ArrayBuffer: a
  // pooled Buffer and a subarray both share a much larger allocation. Reading
  // `.buffer` alone would compile whatever else happens to live there.
  it('reads the window of a view rather than its whole backing buffer', async () => {
    const padded = new Uint8Array(wasm.byteLength + 128)
    padded.set(wasm, 64)
    const view = padded.subarray(64, 64 + wasm.byteLength)

    const loader = createArtifactLoader()
    // Compiling from `view.buffer` would start 64 bytes early and fail on the
    // wasm magic number, so this resolving is the assertion.
    await expect(loader.init({ bytes: view })).resolves.toBeUndefined()
  })

  // The documented recovery for a synchronous caller is to `init()` again, so
  // refusing the second call would make the instruction impossible to follow.
  it('allows init to be called again with no options', async () => {
    const loader = createArtifactLoader()
    await loader.init({ bytes: wasm })
    await expect(loader.init()).resolves.toBeUndefined()
  })

  // Re-pointing after the artifact has been read cannot take effect, so it says
  // so rather than appearing to work.
  it('refuses new options once the artifact has been read', async () => {
    const loader = createArtifactLoader()
    await loader.init({ bytes: wasm })
    expect(loader.init({ url: '/somewhere/else' })).rejects.toThrow(/already been read/)
  })
})
