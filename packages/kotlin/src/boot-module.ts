import { loadModule } from './load-artifact'
import type { FormatFunction } from './types'

/**
 * The lowest Node this artifact can run on.
 *
 * Not a WasmGC floor - Node 22 has WasmGC and compiles this module fine. It is
 * V8's wasm optimizer: the first format call never returns, and resident memory
 * climbs at roughly 70MB/s (3.4GB nine seconds in, 5.4GB at forty) until the
 * process is killed. V8 13 (Node 24) does not do it, and neither does
 * JavaScriptCore, so bun is fine - and bun reports a Node version of its own
 * that satisfies this check.
 *
 * The sibling Java package hits the same thing, which is what makes it TeaVM's
 * output shape rather than anything about ktfmt.
 */
const MINIMUM_NODE_MAJOR = 24

let bootPromise: Promise<FormatFunction> | undefined

/** Fails loudly on a runtime where the module would hang instead of finishing. */
const checkRuntime = (): void => {
  const major = Number.parseInt(process.versions.node ?? '0', 10)
  if (major < MINIMUM_NODE_MAJOR) {
    throw new Error(
      `@scalar/kotlin-fmt needs Node ${MINIMUM_NODE_MAJOR} or newer (this is ${process.version}). ` +
        "Older versions compile the module, but V8's wasm optimizer then consumes memory until the " +
        'process is killed, so the first call would never return.',
    )
  }
}

/**
 * Boots ktfmt compiled to wasm, resolving to the function it exports. The
 * module is compiled at most once per process; every later call awaits the same
 * promise.
 */
export const bootModule = async (): Promise<FormatFunction> => {
  if (bootPromise) return bootPromise

  bootPromise = (async () => {
    checkRuntime()
    const exports = await loadModule()
    const format = exports['format']
    if (typeof format !== 'function') {
      throw new Error('kotlin_fmt.wasm did not export format; the artifact and the runtime are out of step.')
    }
    return format as FormatFunction
  })()

  return bootPromise
}
