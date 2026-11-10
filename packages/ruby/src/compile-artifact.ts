import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import zlib from 'node:zlib'

import type { ArtifactSource } from './types'

const here = path.dirname(fileURLToPath(import.meta.url))

/**
 * Builds the Node artifact source for one of the package's two artifacts.
 *
 * Both are stored brotli-compressed, because both pack down several times over:
 * the Ruby one is Ruby source text and a serialized Ruby heap, the rbcop one is
 * a Rust binary carrying RuboCop's default.yml. Brotli is in node:zlib, so this
 * adds no dependency, and the cost is one decompression per process, not per
 * format.
 *
 * One directory up from this file resolves to the package root whether we are
 * running from `dist` (published) or from `src` (tests), so the same path works
 * in both.
 *
 * The compiled module is kept, so that dropping an instance - the Ruby VM is
 * recycled because formatting leaks its memory, and an rbcop instance is
 * replaced after a trap - does not re-read, re-decompress and re-compile it. A
 * `WebAssembly.Module` is instantiable any number of times and each instance
 * gets its own memory, which is exactly what both need.
 *
 * Async, and compiled with `WebAssembly.compile` rather than the `Module`
 * constructor, so that this matches the browser source's signature and so no
 * caller is built around a synchronous compile. That last part is what makes a
 * browser build possible at all: a browser main thread refuses a synchronous
 * compile above 8MB - "WebAssembly.Compile is disallowed on the main thread, if
 * the buffer size is larger than 8MB", measured on Chrome 141 - and both
 * artifacts are larger than that.
 */
const createArtifactSource = (fileName: string, buildScript: string): ArtifactSource => {
  const artifact = path.join(here, '..', fileName)
  let modulePromise: Promise<WebAssembly.Module> | undefined

  return () => {
    if (modulePromise) return modulePromise

    if (!fs.existsSync(artifact)) {
      throw new Error(
        `${fileName} is missing from ${path.dirname(artifact)}. It is committed to the repository and ships ` +
          `inside the published package, so this usually means a partial checkout; ${buildScript} regenerates it.`,
      )
    }

    modulePromise = WebAssembly.compile(zlib.brotliDecompressSync(fs.readFileSync(artifact)))
    return modulePromise
  }
}

/**
 * CRuby with syntax_tree already required into it, built by
 * build/ruby_fmt/build.sh. The gem lives inside the artifact at /bundle rather
 * than being mounted from disk at boot, so there is nothing to resolve at
 * runtime and no dependency on a separately published ruby.wasm distribution.
 */
export const compileArtifact: ArtifactSource = createArtifactSource('ruby_fmt.wasm.br', 'build/ruby_fmt/build.sh')

/** rbcop's Layout pass, built by build/rbcop_fmt/build.sh. */
export const compileRbcopArtifact: ArtifactSource = createArtifactSource(
  'rbcop_fmt.wasm.br',
  'build/rbcop_fmt/build.sh',
)
