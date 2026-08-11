import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import zlib from 'node:zlib'

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
export const RUNTIME_ENTRY = path.join(here, '..', 'runtime', 'dotnet.js')
const ARCHIVE = path.join(here, '..', 'csharp_fmt.br')

/** An asset the runtime can ask for, located inside the decompressed archive. */
export type Archive = {
  read: (name: string) => Buffer | undefined
}

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

  const raw = zlib.brotliDecompressSync(fs.readFileSync(ARCHIVE))
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
