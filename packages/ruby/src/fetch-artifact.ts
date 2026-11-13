import { decompressBrotli } from './decompress-brotli'
import { toArtifactBytes } from './to-artifact-bytes'
import type { ArtifactSource, InitOptions } from './types'

/**
 * The artifact source for the browser build: fetches the wasm instead of
 * reading it, and expands it with the platform rather than with `node:zlib`.
 *
 * `defaultUrl` is a function so that the caller can write the
 * `new URL('../rbcop_fmt.wasm.br', import.meta.url)` form literally, which is
 * what a bundler looks for. Vite, Rollup and webpack recognise it, emit the
 * artifact as an asset with a hashed name and rewrite the URL to match; loading
 * the package straight from a CDN resolves it the same way with no build step
 * at all. A function also means the default is never resolved for a caller who
 * hands over `bytes` instead.
 *
 * esbuild is the exception - it leaves `new URL(..., import.meta.url)` alone -
 * so an esbuild build has to copy the artifact next to its output or name it
 * with `init({ url })`. That is what `init` is for.
 */
export const createArtifactLoader = ({
  defaultUrl,
  compile = (bytes) => WebAssembly.compile(bytes),
}: {
  /** Where the artifact is when `init` names nowhere else. */
  defaultUrl: () => URL
  /** Compiles the expanded bytes. A parameter so that tests never touch a real artifact. */
  compile?: (bytes: Uint8Array) => Promise<WebAssembly.Module>
}): {
  source: ArtifactSource
  init: (options?: InitOptions) => Promise<void>
} => {
  let modulePromise: Promise<WebAssembly.Module> | undefined
  let compiled: WebAssembly.Module | undefined
  let options: InitOptions = {}

  /** Reads the configured source down to raw wasm bytes. */
  const readBytes = async (): Promise<Uint8Array> => {
    if (options.bytes) {
      return toArtifactBytes(options.bytes)
    }

    const url = options.url ?? defaultUrl()
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`could not fetch the rbcop artifact from ${String(url)} (HTTP ${response.status})`)
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
   * Compiled with the asynchronous `WebAssembly.compile`, because a browser main
   * thread refuses a synchronous compile above 8 MB - "WebAssembly.Compile is
   * disallowed on the main thread, if the buffer size is larger than 8MB",
   * measured on Chrome 141 - and the module is 16 MB.
   *
   * Compilation is cached separately from instantiation because they have very
   * different lifetimes: the compiled module is immutable and worth keeping
   * forever, while an instance is dropped and replaced whenever a format traps.
   */
  const compileArtifact = (): Promise<WebAssembly.Module> => {
    // The rejection is not cached. A transient fetch failure would otherwise
    // stick for the life of the page - every later call awaiting the same dead
    // promise - with `init` refusing to run again because something was already
    // in flight. Dropping it on failure is what leaves a retry possible.
    modulePromise ??= readBytes()
      .then(compile)
      .then((module) => {
        compiled = module
        return module
      })
      .catch((error: unknown) => {
        modulePromise = undefined
        throw error
      })

    return modulePromise
  }

  /**
   * Points the loader at a different artifact, and warms it.
   *
   * Calling this is optional for `format` and it exists for the two cases the
   * default cannot cover: a bundler or CDN that puts the artifact somewhere this
   * module cannot derive, and a caller who would rather pay the download before
   * the first format than during it.
   *
   * Options only take effect before the artifact is first read; afterwards they
   * are refused rather than silently ignored.
   */
  const init = async (next: InitOptions = {}): Promise<void> => {
    // The options used to be two artifacts' worth, with this one under `rbcop`.
    // Accepting that shape now would fetch the default instead of what was named
    // - or, for a top-level `url` still pointing at the retired reprinter's
    // artifact, fail somewhere far less readable than here.
    if ('rbcop' in next) {
      throw new TypeError(
        'init no longer takes an `rbcop` option: the package ships one artifact, rbcop_fmt.wasm.br, and its ' +
          '`url`, `bytes` and `encoding` now go at the top level - init({ url }) rather than init({ rbcop: { url } }).',
      )
    }

    // Calling this again is allowed, and harmless. Only *re-pointing* is
    // refused, and only once the artifact has been read - by then the bytes are
    // compiled and a new `url` could not take effect, so saying so beats
    // appearing to work.
    if (modulePromise && Object.keys(next).length > 0) {
      throw new Error(
        'init can only be given options before the first format - the artifact has already been read. ' +
          'Call init() with no arguments to boot again.',
      )
    }

    if (!modulePromise) options = next
    await compileArtifact()
  }

  return { source: { compile: compileArtifact, compileSync: () => compiled }, init }
}
