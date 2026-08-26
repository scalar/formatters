import { decompressBrotli } from './decompress-brotli'
import { type BootSnapshot, decodeSnapshot, fingerprintArtifact } from './snapshot'
import { toArtifactBytes } from './to-artifact-bytes'
import type { ArtifactSource, InitOptions, SnapshotSource } from './types'

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
  loadSnapshot: SnapshotSource
  init: (options?: InitOptions) => Promise<void>
} => {
  let modulePromise: Promise<WebAssembly.Module> | undefined
  let snapshotPromise: Promise<BootSnapshot | undefined> | undefined
  let options: InitOptions = {}

  /** The expanded artifact's fingerprint, taken while it is compiled - see `snapshot.ts`. */
  let fingerprint: string | undefined

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
      .then((bytes) => {
        fingerprint = fingerprintArtifact(bytes)
        return compile(bytes)
      })
      .catch((error: unknown) => {
        modulePromise = undefined
        throw error
      })

    return modulePromise
  }

  /**
   * Fetches and decodes the boot snapshot, once per page.
   *
   * Resolves to `undefined` for every failure there is - no snapshot deployed
   * beside the artifact, a snapshot from a different build, a fetch that 404s -
   * because a browser that cannot get one should boot the long way rather than
   * refuse to format. It is a large fetch (about 8MB) and it replaces about ten
   * seconds of Ruby, so it is worth having; `init({ snapshot: false })` is how a
   * page that would rather spend the seconds than the bytes says so.
   */
  const loadSnapshot: SnapshotSource = () => {
    if (options.snapshot === false) return Promise.resolve(undefined)

    snapshotPromise ??= (async (): Promise<BootSnapshot | undefined> => {
      if (!fingerprint) return undefined

      const url = options.snapshotUrl ?? new URL('../ruby_fmt.snapshot.br', import.meta.url)
      const response = await fetch(url)
      if (!response.ok) return undefined

      // The snapshot works out its own encoding rather than borrowing the
      // artifact's `encoding` option, because the two are separate files and a
      // caller who serves one expanded need not have done the same for the
      // other. Reading the header is cheap next to the fetch, so trying it
      // as-is and expanding only if that fails costs nothing and removes an
      // option there is no good way for a caller to get right.
      const body = new Uint8Array(await response.arrayBuffer())

      return decodeSnapshot(body, fingerprint) ?? decodeSnapshot(await decompressBrotli(body), fingerprint)
    })().catch(() => undefined)

    return snapshotPromise
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

  return { compileArtifact, loadSnapshot, init }
}
