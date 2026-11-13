import { toArtifactBytes } from './to-artifact-bytes'
import { describe, expect, it } from 'bun:test'

describe('to-artifact-bytes', () => {
  it('copies the window of a view without its surrounding bytes', () => {
    const padded = new Uint8Array(136)
    const wasm = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00])
    padded.set(wasm, 64)

    const bytes = toArtifactBytes(padded.subarray(64, 64 + wasm.byteLength))

    expect(bytes).toEqual(wasm)
    expect(bytes.buffer.byteLength).toBe(wasm.byteLength)
  })
})
