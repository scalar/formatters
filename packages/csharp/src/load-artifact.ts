import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import zlib from 'node:zlib'

import { assetResponse } from './asset-response'
import type { Archive, HostBuilder, ResourceLoader, RuntimeSource } from './types'

const here = path.dirname(fileURLToPath(import.meta.url))

/**
 * The two halves of the image, both produced by build/csharp_fmt/build.sh.
 *
 * `runtime/` holds the four JavaScript files the .NET runtime imports as ES
 * modules - it resolves them by URL, so they have to be real files on disk and
 * cannot be packed. `csharp_fmt.br` is everything else: the assemblies, the
 * runtime wasm and the ICU data, which the runtime asks for through the
 * resource loader and so can be handed as bytes.
 *
 * Splitting them is what keeps the package reasonable. The binary half is 21MB
 * raw and packs to about 4.2MB, and node:zlib expands it once per process.
 *
 * One directory up from this file resolves to the package root whether we are
 * running from `dist` (published) or from `src` (tests), so the same paths work
 * in both.
 */
const RUNTIME_ENTRY = path.join(here, '..', 'runtime', 'dotnet.js')
const ARCHIVE = path.join(here, '..', 'csharp_fmt.br')

/**
 * Room for the whole expanded archive in one allocation.
 *
 * 24MB against today's 21MB, so the archive can grow by a rebuild or two before
 * this stops being one chunk. Getting it wrong only costs the extra chunks back,
 * never correctness.
 */
const ARCHIVE_CHUNK_SIZE = 24 * 1024 * 1024

let archive: Archive | undefined

/**
 * Decompresses the archive and indexes it, once per process.
 *
 * The layout is a 4-byte little-endian header length, that many bytes of JSON
 * mapping each asset name to `[offset, length]`, then the assets end to end.
 * Slices are views onto the one decompressed buffer rather than copies, so
 * indexing 21MB of assemblies costs the decompression and nothing more.
 */
export const openArchive = (): Archive => {
  if (archive) return archive

  if (!fs.existsSync(ARCHIVE)) {
    throw new Error(
      `csharp_fmt.br is missing from ${path.dirname(ARCHIVE)}. It is committed to the repository ` +
        'and ships inside the published package, so this usually means a partial checkout; ' +
        'build/csharp_fmt/build.sh regenerates it.',
    )
  }

  // The chunk size is the size of the output buffer node:zlib fills before it
  // allocates another one and, at the end, concatenates them all. It defaults to
  // 16KB, which for a 21MB archive is over 1300 allocations and a 21MB copy to
  // stitch them back together. Asking for the whole thing in one chunk is worth
  // about 20ms of the boot and costs nothing - the memory is allocated either
  // way, just not thirteen hundred times.
  const raw = zlib.brotliDecompressSync(fs.readFileSync(ARCHIVE), { chunkSize: ARCHIVE_CHUNK_SIZE })
  const headerLength = raw.readUInt32LE(0)
  const index = JSON.parse(raw.subarray(4, 4 + headerLength).toString('utf8')) as Record<string, [number, number]>
  const base = 4 + headerLength

  archive = {
    read: (name) => {
      const entry = index[name]
      if (!entry) return undefined
      const [offset, length] = entry
      return raw.subarray(base + offset, base + offset + length)
    },
  }
  return archive
}

/**
 * The Node runtime source: assets come out of the archive, and the four
 * `runtime/*.js` files are left to load themselves.
 *
 * Returning `undefined` for those four is deliberate. They are imported as ES
 * modules by URL, and on disk they sit next to `dotnet.js`, so the runtime's own
 * relative resolution already finds them - there is nothing for this to improve
 * on. The browser source has to answer that question itself, because a bundler
 * moves and renames them; see `fetch-artifact.ts`.
 */
export const nodeRuntimeSource: RuntimeSource = {
  loadHostBuilder: async () => {
    // Imported by URL rather than by path because this file is ESM and the
    // runtime lives outside `dist`; a bare relative specifier would resolve
    // against the wrong directory once the package is installed.
    const { dotnet } = (await import(pathToFileURL(RUNTIME_ENTRY).href)) as { dotnet: HostBuilder }
    return dotnet
  },

  openResources: async (): Promise<ResourceLoader> => {
    const archive = openArchive()

    // The runtime asks by asset name; `defaultUri` is the fallback for the rare
    // entry whose name is a path.
    return (_type, name, defaultUri) => {
      const bytes = archive.read(name) ?? archive.read(path.basename(defaultUri ?? ''))
      return bytes ? Promise.resolve(assetResponse(bytes, name)) : undefined
    }
  },
}
