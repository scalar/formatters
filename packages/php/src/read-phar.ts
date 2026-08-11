import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import zlib from 'node:zlib'

const here = path.dirname(fileURLToPath(import.meta.url))

/**
 * PHP CS Fixer's official phar, built by build/php_fmt/build.sh.
 *
 * Stored brotli-compressed: a phar is a container of PHP source text and packs
 * down about 8x, which is the difference between a 3.5MB and a 0.44MB install.
 * The cost is one decompression per process, around 9ms, not one per format.
 * Brotli is in node:zlib, so this adds no dependency.
 *
 * One directory up from this file resolves to the package root whether we are
 * running from `dist` (published) or from `src` (tests), so the same path works
 * in both.
 */
const ARTIFACT = path.join(here, '..', 'php_fmt.phar.br')

/**
 * The decompressed phar, kept because it is written into every PHP instance
 * this process boots and re-reading 3.5MB from disk to do that would be waste.
 */
let phar: Buffer | undefined

/** Reads and decompresses the phar artifact, at most once per process. */
export const readPhar = (): Buffer => {
  if (phar) return phar

  if (!fs.existsSync(ARTIFACT)) {
    throw new Error(
      `php_fmt.phar.br is missing from ${path.dirname(ARTIFACT)}. It is committed to the repository and ships ` +
        'inside the published package, so this usually means a partial checkout; ' +
        'build/php_fmt/build.sh regenerates it.',
    )
  }

  phar = zlib.brotliDecompressSync(fs.readFileSync(ARTIFACT))
  return phar
}
