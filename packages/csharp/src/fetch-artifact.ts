import { decompressBrotli } from './decompress-brotli'
import type { Archive, HostBuilder, InitOptions, ResourceLoader, RuntimeSource } from './types'

/**
 * The four JavaScript files the .NET runtime loads as ES modules.
 *
 * These are the reason this package needed more than a fetch to reach a browser.
 * Every other asset - the assemblies, the runtime wasm, the ICU data - can be
 * handed to the runtime as bytes, but an ES module can only be pointed at, so
 * these have to exist at a URL.
 *
 * `new URL(name, base)` against `import.meta.url` is what makes that free. Vite,
 * Rollup and webpack recognise the form, emit each file as an asset and rewrite
 * the URL to wherever it landed - verified against a real Vite build, which
 * emits all four under hashed names and still boots. A CDN resolves them with no
 * build step at all. esbuild is the exception: it leaves `new URL` alone, so an
 * esbuild build needs the four files copied beside its output or named with
 * `init({ runtimeBaseUrl })`.
 *
 * What no bundler will do is follow `dotnet.js`'s own relative imports of its
 * siblings, because it never parses the file - which is exactly why the loader
 * below answers for all four by name rather than letting three of them resolve
 * themselves the way the Node source does.
 */
const RUNTIME_MODULES: Record<string, () => string> = {
  // Spelled out one static `new URL` literal each, rather than built from a
  // template. That is not style: a bundler only rewrites this form when it can
  // read the specifier at build time, and `new URL(`../runtime/${name}`, ...)`
  // is a runtime string it cannot follow. Four literals is the difference
  // between the assets being emitted and the consumer being told to copy them.
  'dotnet.js': () => new URL('../runtime/dotnet.js', import.meta.url).href,
  'dotnet.boot.js': () => new URL('../runtime/dotnet.boot.js', import.meta.url).href,
  'dotnet.runtime.js': () => new URL('../runtime/dotnet.runtime.js', import.meta.url).href,
  'dotnet.native.js': () => new URL('../runtime/dotnet.native.js', import.meta.url).href,
}

/** Resource types whose answer must be a URL string rather than bytes. */
const MODULE_TYPES = new Set(['dotnetjs', 'manifest'])

/** The archive layout: a length-prefixed JSON index, then the assets end to end. */
const indexArchive = (raw: Uint8Array): Archive => {
  const headerLength = new DataView(raw.buffer, raw.byteOffset, raw.byteLength).getUint32(0, true)
  const index = JSON.parse(new TextDecoder().decode(raw.subarray(4, 4 + headerLength))) as Record<
    string,
    [number, number]
  >
  const base = 4 + headerLength

  return {
    read: (name) => {
      const entry = index[name]
      if (!entry) return undefined
      const [offset, length] = entry
      // A view onto the one decompressed buffer rather than a copy, so indexing
      // 21MB of assemblies costs the decompression and nothing more.
      return raw.subarray(base + offset, base + offset + length)
    },
  }
}

/**
 * The browser runtime source: the archive is fetched and expanded here, and the
 * runtime's own JavaScript is resolved to URLs this module can derive.
 */
export const createArtifactLoader = (): {
  source: RuntimeSource
  init: (options?: InitOptions) => Promise<void>
} => {
  let resourcesPromise: Promise<ResourceLoader> | undefined
  let options: InitOptions = {}

  /**
   * Where one of the runtime's four JavaScript files is served from, or
   * `undefined` for a name that is not one of them.
   */
  const runtimeUrl = (name: string): string | undefined => {
    if (options.runtimeBaseUrl) {
      return RUNTIME_MODULES[name] ? `${String(options.runtimeBaseUrl).replace(/\/$/, '')}/${name}` : undefined
    }
    return RUNTIME_MODULES[name]?.()
  }

  /** Reads the configured source down to the expanded archive bytes. */
  const readArchive = async (): Promise<Uint8Array> => {
    if (options.bytes) {
      const view = options.bytes
      return ArrayBuffer.isView(view)
        ? new Uint8Array(view.buffer, view.byteOffset, view.byteLength)
        : new Uint8Array(view)
    }

    const url = options.url ?? new URL('../csharp_fmt.br', import.meta.url)
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`could not fetch the CSharpier archive from ${String(url)} (HTTP ${response.status})`)
    }

    const body = new Uint8Array(await response.arrayBuffer())

    // `none` covers both of the ways a caller can hand over expanded bytes: a
    // server that set `Content-Encoding: br`, which the browser unwraps before
    // we ever see it, and a URL pointing at an uncompressed archive.
    return options.encoding === 'none' ? body : decompressBrotli(body)
  }

  const source: RuntimeSource = {
    loadHostBuilder: async () => {
      const entry = runtimeUrl('dotnet.js')
      if (!entry) throw new Error('the .NET runtime entry could not be resolved')
      const { dotnet } = (await import(/* webpackIgnore: true */ entry)) as { dotnet: HostBuilder }
      return dotnet
    },

    openResources: (): Promise<ResourceLoader> => {
      // The rejection is not cached. A transient fetch failure would otherwise
      // stick for the life of the page - every later call awaiting the same dead
      // promise - with `init` refusing to run again because something was already
      // in flight. Dropping it on failure is what leaves a retry possible.
      resourcesPromise ??= readArchive()
        .then((raw) => {
          const archive = indexArchive(raw)

          return (type: string, name: string, defaultUri: string) => {
            // The runtime asks for assets by name, and `defaultUri`'s last
            // segment is the fallback for the rare entry whose name is a path.
            // It has to be derived separately: folding it into one `basename`
            // makes it collapse to `name` whenever `name` is set, which is every
            // time, and the fallback silently never fires - as it does not in the
            // Node loader, which reads the two independently.
            const fromUri = (defaultUri ?? '').split('/').pop() ?? ''

            if (MODULE_TYPES.has(type)) return runtimeUrl(name) ?? runtimeUrl(fromUri)

            const bytes = archive.read(name) ?? archive.read(fromUri)
            return bytes ? Promise.resolve(new Response(bytes)) : undefined
          }
        })
        .catch((error: unknown) => {
          resourcesPromise = undefined
          throw error
        })

      return resourcesPromise
    },
  }

  /**
   * Points the loader at different assets, and optionally warms them.
   *
   * Calling this is optional - `format` works without it - and it exists for the
   * two cases the default cannot cover: a bundler or CDN that puts the archive
   * or the runtime files somewhere this module cannot derive, and a caller who
   * would rather pay the download before the first format than during it.
   *
   * It must be called before the first `format`, because that is what reads the
   * archive; afterwards it throws rather than silently doing nothing.
   */
  const init = async (next: InitOptions = {}): Promise<void> => {
    // Calling this again is not only allowed, it is the documented way to
    // recover: `formatSync` asks for another `init` when it cannot rebuild the
    // runtime itself. Only *re-pointing* is refused, and only once the assets
    // have been read - by then they are loaded and a new `url` could not take
    // effect, so saying so beats appearing to work.
    if (resourcesPromise && Object.keys(next).length > 0) {
      throw new Error(
        'init can only be given options before the first format - the assets have already been read. ' +
          'Call init() with no arguments to boot again.',
      )
    }

    if (!resourcesPromise) options = next
    await source.openResources()
  }

  return { source, init }
}
