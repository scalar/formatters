import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import zlib from 'node:zlib'

import type { ArtifactSource } from './types'

const here = path.dirname(fileURLToPath(import.meta.url))

/**
 * ktrs's formatter, built by build/kotlin_fmt/build.sh.
 *
 * Stored brotli-compressed, 864 KB packing to 200 KB. Brotli is in node:zlib,
 * so this adds no dependency, and the cost is one decompression per process,
 * not per format.
 *
 * One directory up from this file resolves to the package root whether we are
 * running from `dist` (published) or from `src` (tests), so the same path works
 * in both.
 */
const ARTIFACT = path.join(here, '..', 'kotlin_fmt.wasm.br')

let compiled: WebAssembly.Module | undefined

/**
 * Reads, decompresses and compiles the artifact, once per process, without
 * awaiting.
 *
 * Synchronous on purpose: nothing limits the size of a synchronous compile
 * under Node, and doing it this way is what lets `formatSync` work with no
 * `init()` at all. It costs a few milliseconds, once.
 *
 * The compiled module is kept, so that replacing an instance after a trap does
 * not re-read, re-decompress and re-compile it.
 */
const compileSync = (): WebAssembly.Module => {
  if (compiled) return compiled

  if (!fs.existsSync(ARTIFACT)) {
    throw new Error(
      `kotlin_fmt.wasm.br is missing from ${path.dirname(ARTIFACT)}. It is committed to the repository and ships ` +
        'inside the published package, so this usually means a partial checkout; build/kotlin_fmt/build.sh ' +
        'regenerates it.',
    )
  }

  compiled = new WebAssembly.Module(zlib.brotliDecompressSync(fs.readFileSync(ARTIFACT)))
  return compiled
}

/** The Node artifact source: the module from disk, compiled synchronously and cached. */
export const nodeArtifact: ArtifactSource = {
  compile: async () => compileSync(),
  compileSync,
}
