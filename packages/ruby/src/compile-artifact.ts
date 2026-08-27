import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import zlib from 'node:zlib'

const here = path.dirname(fileURLToPath(import.meta.url))

/**
 * CRuby with syntax_tree and RuboCop already required into it, built by
 * build/ruby_fmt/build.sh.
 *
 * The gems live inside the artifact at /bundle rather than being mounted from
 * disk at boot, so there is nothing to resolve at runtime and no dependency on
 * a separately published ruby.wasm distribution.
 *
 * Stored brotli-compressed. The wasm is Ruby source text and a serialized Ruby
 * heap, and compresses about 5.5x, which is the difference between a 67MB and a
 * 12.2MB install; the cost is one decompression per process, not per format.
 * Brotli is in node:zlib, so this adds no dependency.
 *
 * One directory up from this file resolves to the package root whether we are
 * running from `dist` (published) or from `src` (tests), so the same path works
 * in both.
 */
const ARTIFACT = path.join(here, '..', 'ruby_fmt.wasm.br')

/**
 * The compiled module, kept so recycling the VM does not re-read, re-decompress
 * and re-compile 67MB. A WebAssembly.Module is instantiable any number of times
 * and each instance gets its own memory, which is exactly what recycling needs.
 */
let modulePromise: Promise<WebAssembly.Module> | undefined

/**
 * Decompresses and compiles the wasm artifact, at most once per process.
 *
 * Async, and compiled with `WebAssembly.compile` rather than the `Module`
 * constructor, so that this matches the browser source's signature and so no
 * caller is built around a synchronous compile. That last part is what makes a
 * browser build possible at all: a browser main thread refuses a synchronous
 * compile above 8MB - "WebAssembly.Compile is disallowed on the main thread, if
 * the buffer size is larger than 8MB", measured on Chrome 141 - and this
 * artifact is 67MB. Rust's 6.2MB would squeak under; Swift's 48.7MB would not,
 * and neither would this.
 */
export const compileArtifact = (): Promise<WebAssembly.Module> => {
  if (modulePromise) return modulePromise

  if (!fs.existsSync(ARTIFACT)) {
    throw new Error(
      `ruby_fmt.wasm.br is missing from ${path.dirname(ARTIFACT)}. It is committed to the repository and ships ` +
        'inside the published package, so this usually means a partial checkout; ' +
        'build/ruby_fmt/build.sh regenerates it.',
    )
  }

  modulePromise = WebAssembly.compile(zlib.brotliDecompressSync(fs.readFileSync(ARTIFACT)))
  return modulePromise
}
