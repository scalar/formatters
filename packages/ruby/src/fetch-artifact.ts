import { decompressBrotli } from './decompress-brotli'
import { toArtifactBytes } from './to-artifact-bytes'
import type { ArtifactSource, InitOptions } from './types'

/**
 * The artifact source for the browser build: fetches the wasm instead of
 * reading it, and expands it with the platform rather than with `node:zlib`.
 *
 * The default URL is resolved against this module, so `new URL(..., import.meta.url)`
 * is what a bundler sees. Vite, Rollup and webpack recognise that form, emit
 * `ruby_fmt.wasm.br` as an asset with a hashed name and rewrite the URL to match;
 * loading the package straight from a CDN resolves it the same way with no build
 * step at all.
 *
 * esbuild is the exception - it leaves `new URL(..., import.meta.url)` alone -
 * so an esbuild build has to copy the artifact next to its output or name it
 * with `init({ url })`. That is what `init` is for.
 */
export const createArtifactLoader = (
  compile: (bytes: Uint8Array) => Promise<WebAssembly.Module> = (bytes) => WebAssembly.compile(bytes),
): {
  compileArtifact: ArtifactSource
  init: (options?: InitOptions) => Promise<void>
} => {
  let modulePromise: Promise<WebAssembly.Module> | undefined
  let options: InitOptions = {}

  /** Reads the configured source down to raw wasm bytes. */
  const readBytes = async (): Promise<Uint8Array> => {
    if (options.bytes) {
      return toArtifactBytes(options.bytes)
    }

    const url = options.url ?? new URL('../ruby_fmt.wasm.br', import.meta.url)
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`could not fetch the syntax_tree artifact from ${String(url)} (HTTP ${response.status})`)
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
    // The rejection is not cached. A transient fetch failure would otherwise
    // stick for the life of the page - every later call awaiting the same dead
    // promise - with `init` refusing to run again because something was already
    // in flight. Dropping it on failure is what leaves a retry possible.
    modulePromise ??= readBytes()
      .then(compile)
      .catch((error: unknown) => {
        modulePromise = undefined
        throw error
      })

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
    // Calling this again is not only allowed, it is the documented way to
    // recover: `formatSync` asks for another `init` when it cannot rebuild the
    // instance itself. Only *re-pointing* is refused, and only once the artifact
    // has been read - by then the bytes are compiled and a new `url` could not
    // take effect, so saying so beats appearing to work.
    if (modulePromise && Object.keys(next).length > 0) {
      throw new Error(
        'init can only be given options before the first format - the artifact has already been read. ' +
          'Call init() with no arguments to boot again.',
      )
    }

    if (!modulePromise) options = next
    await compileArtifact()
  }

  return { compileArtifact, init }
}
