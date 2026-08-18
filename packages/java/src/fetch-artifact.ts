import { decompressBrotli } from './decompress-brotli'
import type { InitOptions, ModuleLoader, Runtime } from './types'

/**
 * The module loader for the browser build: fetches the wasm instead of reading
 * it, and expands it with the platform rather than with `node:zlib`.
 *
 * The default URL is resolved against this module, so `new URL(..., import.meta.url)`
 * is what a bundler sees. Vite, Rollup and webpack recognise that form, emit
 * `java_fmt.wasm.br` as an asset with a hashed name and rewrite the URL to match;
 * loading the package straight from a CDN resolves it the same way with no build
 * step at all.
 *
 * esbuild is the exception - it leaves `new URL(..., import.meta.url)` alone -
 * so an esbuild build has to copy the artifact next to its output or name it
 * with `init({ url })`. That is what `init` is for.
 *
 * TeaVM's runtime is imported by its package subpath rather than by a URL, which
 * matters: a bundler can follow a literal specifier and include the file, where
 * a dynamic `import(someUrl)` would be left as a runtime fetch of a path nothing
 * ever emitted. Unbundled, the subpath resolves through the same import map that
 * resolves every other bare specifier.
 */
export const createArtifactLoader = (): {
  loadModule: ModuleLoader
  init: (options?: InitOptions) => Promise<void>
} => {
  let exportsPromise: Promise<Record<string, unknown>> | undefined
  let options: InitOptions = {}

  /** Reads the configured source down to raw wasm bytes. */
  const readBytes = async (): Promise<ArrayBuffer> => {
    if (options.bytes) {
      const view = options.bytes
      // Sliced to the exact bytes either way: a view's `.buffer` is only the
      // whole artifact when it happens to start at zero and run to the end.
      return (
        ArrayBuffer.isView(view) ? view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) : view.slice(0)
      ) as ArrayBuffer
    }

    const url = options.url ?? new URL('../java_fmt.wasm.br', import.meta.url)
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`could not fetch the google-java-format artifact from ${String(url)} (HTTP ${response.status})`)
    }

    const body = new Uint8Array(await response.arrayBuffer())

    // `none` covers both of the ways a caller can hand over expanded bytes: a
    // server that set `Content-Encoding: br`, which the browser unwraps before
    // we ever see it, and a URL pointing at an uncompressed `.wasm`.
    const wasm = options.encoding === 'none' ? body : await decompressBrotli(body)

    // Slice to the exact bytes: a view's `.buffer` is only the whole artifact
    // when it happens to start at zero and run to the end.
    return wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) as ArrayBuffer
  }

  /**
   * Compiles and instantiates the module, resolving to its exports, once per page.
   */
  const loadModule: ModuleLoader = () => {
    // The rejection is not cached. A transient fetch failure would otherwise
    // stick for the life of the page - every later call awaiting the same dead
    // promise - with `init` refusing to run again because something was already
    // in flight. Dropping it on failure is what leaves a retry possible.
    exportsPromise ??= (async () => {
      const [runtime, wasm] = await Promise.all([import('@scalar/java-fmt/runtime') as Promise<Runtime>, readBytes()])
      const { exports } = await runtime.load(wasm, {})
      return exports
    })().catch((error: unknown) => {
      exportsPromise = undefined
      throw error
    })

    return exportsPromise
  }

  /**
   * Points the loader at a different artifact, and optionally warms it.
   *
   * Calling this is optional - `format` works without it - and it exists for the
   * two cases the default cannot cover: a bundler or CDN that puts the artifact
   * somewhere this module cannot derive, and a caller who would rather pay the
   * download before the first format than during it.
   *
   * It must be called before the first `format`, because that is what loads the
   * module; afterwards it throws rather than silently doing nothing.
   */
  const init = async (next: InitOptions = {}): Promise<void> => {
    // Calling this again is not only allowed, it is the documented way to
    // recover: `formatSync` asks for another `init` when it cannot rebuild the
    // instance itself. Only *re-pointing* is refused, and only once the artifact
    // has been read - by then the bytes are loaded and a new `url` could not
    // take effect, so saying so beats appearing to work.
    if (exportsPromise && Object.keys(next).length > 0) {
      throw new Error(
        'init can only be given options before the first format - the artifact has already been read. ' +
          'Call init() with no arguments to boot again.',
      )
    }

    if (!exportsPromise) options = next
    await loadModule()
  }

  return { loadModule, init }
}
