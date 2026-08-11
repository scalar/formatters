import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import zlib from 'node:zlib'

const here = path.dirname(fileURLToPath(import.meta.url))

/**
 * The module, built by build/rust_fmt/build.sh.
 *
 * It is stored brotli-compressed because 6.2MB of wasm packs to 1.3MB.
 * node:zlib decompresses it once per process in ~40ms and adds no dependency.
 *
 * One directory up from this file resolves to the package root whether we are
 * running from `dist` (published) or from `src` (tests), so the same path works
 * in both.
 */
const ARTIFACT = path.join(here, '..', 'rust_fmt.wasm.br')

let modulePromise: Promise<WebAssembly.Module> | undefined

/**
 * Decompresses and compiles the artifact, once per process.
 *
 * Compilation is cached separately from instantiation because they have very
 * different lifetimes: the compiled module is immutable and worth keeping
 * forever, while an instance is dropped and replaced whenever a format traps.
 */
export const compileArtifact = (): Promise<WebAssembly.Module> => {
  if (modulePromise) return modulePromise

  modulePromise = (async () => {
    if (!fs.existsSync(ARTIFACT)) {
      throw new Error(
        `rust_fmt.wasm.br is missing from ${path.dirname(ARTIFACT)}. It is committed to the repository and ships ` +
          'inside the published package, so this usually means a partial checkout; ' +
          'build/rust_fmt/build.sh regenerates it.',
      )
    }

    const wasm = zlib.brotliDecompressSync(fs.readFileSync(ARTIFACT))
    return WebAssembly.compile(wasm)
  })()

  return modulePromise
}
