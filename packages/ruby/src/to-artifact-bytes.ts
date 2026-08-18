/** Copies an artifact source into a standalone byte window for the wasm compiler. */
export const toArtifactBytes = (source: ArrayBuffer | ArrayBufferView): Uint8Array => {
  if (ArrayBuffer.isView(source)) {
    return new Uint8Array(source.buffer, source.byteOffset, source.byteLength).slice()
  }

  return new Uint8Array(source)
}
