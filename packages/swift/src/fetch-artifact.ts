import { decompressBrotli } from './decompress-brotli'
import type { ArtifactSource, InitOptions } from './types'

/**
 * The artifact source for the browser build: fetches the wasm instead of
 * reading it, and expands it with the platform rather than with `node:zlib`.
 *
 * The default URL is resolved against this module, so `new URL(..., import.meta.url)`
 * is what a bundler sees. Vite, webpack, Rollup and esbuild all recognise that
 * form and emit `swift_fmt.wasm.br` as an asset with a hashed name, and loading
 * the package straight from a CDN resolves it the same way with no build step
 * at all. Nothing here needs configuring for either to work.
 */
export const createArtifactLoader = (): {
  compileArtifact: ArtifactSource
  init: (options?: InitOptions) => Promise<void>
} => {
  let modulePromise: Promise<WebAssembly.Module> | undefined
  let options: InitOptions = {}

  /** Reads the configured source down to raw wasm bytes. */
  const readBytes = async (): Promise<Uint8Array> => {
    if (options.bytes) return new Uint8Array(ArrayBuffer.isView(options.bytes) ? options.bytes.buffer : options.bytes)

    const url = options.url ?? new URL('../swift_fmt.wasm.br', import.meta.url)
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`could not fetch the swift-format artifact from ${String(url)} (HTTP ${response.status})`)
    }

    const body = new Uint8Array(await response.arrayBuffer())

    // `none` covers both of the ways a caller can hand over expanded bytes: a
    // server that set `Content-Encoding: br`, which the browser unwraps before
    // we ever see it, and a URL pointing at an uncompressed `.wasm`.
    return options.encoding === 'none' ? body : decompressBrotli(body)
  }

  /**
   * Fetches, decompresses and compiles the artifact, once per page.
   *
   * Compilation is cached separately from instantiation because they have very
   * different lifetimes: the compiled module is immutable and worth keeping
   * forever, while an instance is dropped and replaced whenever a format traps.
   */
  const compileArtifact: ArtifactSource = () => {
    modulePromise ??= readBytes().then((wasm) => WebAssembly.compile(wasm))
    return modulePromise
  }

  /**
   * Points the loader at a different artifact, and optionally warms it.
   *
   * Calling this is optional - `format` works without it - and it exists for the
   * two cases the default cannot cover: a bundler or CDN that puts the artifact
   * somewhere this module cannot derive, and a caller who would rather pay the
   * download before the first format than during it.
   *
   * It must be called before the first `format`, because that is what compiles
   * the module; afterwards it throws rather than silently doing nothing.
   */
  const init = async (next: InitOptions = {}): Promise<void> => {
    if (modulePromise) throw new Error('init must be called before the first format, and only once')
    options = next
    await compileArtifact()
  }

  return { compileArtifact, init }
}
