import { loadModule } from './load-artifact'
import type { FormatFunction } from './types'

/**
 * The lowest Node this artifact can run on.
 *
 * Not a WasmGC floor - Node 22 has WasmGC and runs the module correctly. It is
 * V8's wasm inliner: once the module is warm, the background optimizer grows
 * without bound on it, ~100MB/s, until the process is killed. Nothing is wrong
 * with the answers, but the process never exits, which reads as a hang. V8 13
 * (Node 24) does not do it, and neither does JavaScriptCore, so bun is fine -
 * and bun reports a Node version of its own that satisfies this check.
 */
const MINIMUM_NODE_MAJOR = 24

let bootPromise: Promise<FormatFunction> | undefined

/** Fails loudly on a runtime where the module would hang instead of finishing. */
const checkRuntime = (): void => {
  const major = Number.parseInt(process.versions.node ?? '0', 10)
  if (major < MINIMUM_NODE_MAJOR) {
    throw new Error(
      `@scalar/java-fmt needs Node ${MINIMUM_NODE_MAJOR} or newer (this is ${process.version}). ` +
        "Older versions format correctly but V8's wasm optimizer then consumes memory until the " +
        'process is killed, so it would never exit.',
    )
  }
}

/**
 * Boots google-java-format compiled to wasm, resolving to the function it
 * exports. The module is compiled at most once per process; every later call
 * awaits the same promise.
 */
export const bootModule = async (): Promise<FormatFunction> => {
  if (bootPromise) return bootPromise

  bootPromise = (async () => {
    checkRuntime()
    const exports = await loadModule()
    const format = exports['format']
    if (typeof format !== 'function') {
      throw new Error('java_fmt.wasm did not export format; the artifact and the runtime are out of step.')
    }
    return format as FormatFunction
  })()

  return bootPromise
}
