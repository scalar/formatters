import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import zlib from 'node:zlib'

const here = path.dirname(fileURLToPath(import.meta.url))

/**
 * CRuby with syntax_tree baked in, built by build/ruby_fmt/build.sh.
 *
 * The gems live inside the artifact at /bundle rather than being mounted from
 * disk at boot, so there is nothing to resolve at runtime and no dependency on
 * a separately published ruby.wasm distribution.
 *
 * Stored brotli-compressed. The wasm is mostly Ruby source text and compresses
 * about 5x, which is the difference between a 20MB and a 3.8MB install; the cost
 * is one decompression per process, not per format. Brotli is in node:zlib, so
 * this adds no dependency.
 *
 * One directory up from this file resolves to the package root whether we are
 * running from `dist` (published) or from `src` (tests), so the same path works
 * in both.
 */
const ARTIFACT = path.join(here, '..', 'ruby_fmt.wasm.br')

/**
 * The compiled module, kept so recycling the VM does not re-read, re-decompress
 * and re-compile 20MB. A WebAssembly.Module is instantiable any number of times
 * and each instance gets its own memory, which is exactly what recycling needs.
 */
let compiledModule: WebAssembly.Module | undefined

/** Decompresses and compiles the wasm artifact, at most once per process. */
export const compileArtifact = (): WebAssembly.Module => {
  if (compiledModule) return compiledModule

  if (!fs.existsSync(ARTIFACT)) {
    throw new Error(
      `ruby_fmt.wasm.br is missing from ${path.dirname(ARTIFACT)}. It is committed to the repository and ships ` +
        'inside the published package, so this usually means a partial checkout; ' +
        'build/ruby_fmt/build.sh regenerates it.',
    )
  }

  compiledModule = new WebAssembly.Module(zlib.brotliDecompressSync(fs.readFileSync(ARTIFACT)))
  return compiledModule
}
