import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import zlib from 'node:zlib'

import { fingerprintArtifact } from './snapshot'

const here = path.dirname(fileURLToPath(import.meta.url))

/**
 * Where the artifact lives on disk.
 *
 * Exported because `read-snapshot.ts` needs it too: a boot snapshot is only
 * valid for the exact artifact it was taken against, and this file's byte
 * length is the cheap staleness check.
 *
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
export const ARTIFACT_PATH = path.join(here, '..', 'ruby_fmt.wasm.br')

/**
 * The compiled module, kept so recycling the VM does not re-read, re-decompress
 * and re-compile 39MB. A WebAssembly.Module is instantiable any number of times
 * and each instance gets its own memory, which is exactly what recycling needs.
 */
let modulePromise: Promise<WebAssembly.Module> | undefined

/**
 * The expanded artifact's fingerprint, taken on the way past.
 *
 * `read-snapshot.ts` needs it to decide whether the snapshot beside the
 * artifact was taken against *this* artifact, and this is the only place the
 * expanded bytes exist. Set during the compile above, which `boot-vm.ts` always
 * awaits before it asks for a snapshot.
 */
let fingerprint: string | undefined

/**
 * Decompresses and compiles the wasm artifact, at most once per process.
 *
 * Async, and compiled with `WebAssembly.compile` rather than the `Module`
 * constructor, so that this matches the browser source's signature and so no
 * caller is built around a synchronous compile. That last part is what makes a
 * browser build possible at all: a browser main thread refuses a synchronous
 * compile above 8MB - "WebAssembly.Compile is disallowed on the main thread, if
 * the buffer size is larger than 8MB", measured on Chrome 141 - and this
 * artifact is 20.3MB. Rust's 6.2MB would squeak under; Swift's 48.7MB would not,
 * and neither would this.
 */
export const compileArtifact = (): Promise<WebAssembly.Module> => {
  if (modulePromise) return modulePromise

  if (!fs.existsSync(ARTIFACT_PATH)) {
    throw new Error(
      `ruby_fmt.wasm.br is missing from ${path.dirname(ARTIFACT_PATH)}. It is committed to the repository and ships ` +
        'inside the published package, so this usually means a partial checkout; ' +
        'build/ruby_fmt/build.sh regenerates it.',
    )
  }

  modulePromise = (async (): Promise<WebAssembly.Module> => {
    const wasm = zlib.brotliDecompressSync(fs.readFileSync(ARTIFACT_PATH))
    fingerprint = fingerprintArtifact(wasm)
    return WebAssembly.compile(wasm)
  })()

  return modulePromise
}

/**
 * The fingerprint of the artifact this process compiled, or `undefined` before
 * it has compiled one.
 *
 * Synchronous on purpose: the only caller is the snapshot source, which
 * `boot-vm.ts` reaches strictly after awaiting {@link compileArtifact}.
 */
export const artifactFingerprint = (): string | undefined => fingerprint
