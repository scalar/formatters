import type { FormatFunction, ModuleLoader } from './types'

/**
 * The major below which this artifact hangs. One of the two things that set the
 * floor - the other is below, and is a later 24 than this, so the version this
 * package actually asks for is `MINIMUM_NODE_FOR_EXNREF`.
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

/**
 * The lowest Node that accepts the module's opcodes, which is a *later* 24 than
 * the one above - hence a second, separate check.
 *
 * TeaVM emits the final wasm exception-handling proposal: `try_table`, opcode
 * 0x1f, over `exnref`. V8 accepts it unflagged on Node 22, rejects it on Node
 * 24.0 through 24.14 - `Invalid opcode 0x1f (enable with
 * --experimental-wasm-exnref)`, at compile time, before a single format call -
 * and accepts it again from 24.15.0 on.
 */
const MINIMUM_NODE_FOR_EXNREF = '24.15.0'

/**
 * A whole wasm module in 28 bytes: one function whose body is an empty
 * `try_table`. Compiling it asks the *engine* whether the artifact's opcodes
 * will be accepted, which is the question that actually matters - the Node
 * version is only a proxy for it, and a wrong one under bun, whose
 * JavaScriptCore takes the opcode while it reports a Node version below the
 * floor above.
 */
// biome-ignore format: the sections of a wasm module, one per line - reflowing this loses the whole point
const EXNREF_PROBE = Uint8Array.from([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, // magic and version
  0x01, 0x04, 0x01, 0x60, 0x00, 0x00, // types: one, () -> ()
  0x03, 0x02, 0x01, 0x00, // functions: one, of that type
  0x0a, 0x08, 0x01, 0x06, 0x00, 0x1f, 0x40, 0x00, 0x0b, 0x0b, // code: try_table, no catches
])

/** Whether this engine compiles `try_table`, and so this package's artifact. */
const supportsExnref = (): boolean => {
  try {
    new WebAssembly.Module(EXNREF_PROBE)
    return true
  } catch {
    return false
  }
}

/**
 * Fails loudly on a runtime where the module would hang, or not compile at all.
 *
 * Two checks, because they catch different things. The probe asks the engine
 * directly and is the one that matters everywhere - a browser has no Node
 * version to inspect, and bun reports one that would fail the version check
 * while its JavaScriptCore takes the opcode happily. The version check exists
 * only for the V8 inliner bug, which is not something an engine can be asked
 * about, and so it runs only where there is a Node version to read.
 */
const checkRuntime = (): void => {
  // `typeof` rather than a truthiness test: a bare `process` is a ReferenceError
  // in a browser, and this file is on the browser build's path.
  const version = typeof process === 'undefined' ? undefined : process.versions.node

  if (version !== undefined && Number.parseInt(version, 10) < MINIMUM_NODE_MAJOR) {
    throw new Error(
      `@scalar/kotlin-fmt needs Node ${MINIMUM_NODE_FOR_EXNREF} or newer (this is v${version}). ` +
        "Older versions format correctly but V8's wasm optimizer then consumes memory until the " +
        'process is killed, so it would never exit.',
    )
  }

  if (!supportsExnref()) {
    // Phrased against whichever runtime this is. On Node the actionable answer
    // is a version, so it leads with one; in a browser there is no version to
    // name and the engine floor is the useful thing to say instead.
    throw new Error(
      version === undefined
        ? '@scalar/kotlin-fmt needs an engine that accepts the final wasm exception-handling ' +
            'opcodes. Chrome 137, Firefox 131 and Safari 18.4 accept them; older browsers do not.'
        : `@scalar/kotlin-fmt needs Node ${MINIMUM_NODE_FOR_EXNREF} or newer (this is v${version}). ` +
            'The module uses the final wasm exception-handling opcodes, which V8 rejects on earlier ' +
            'Node 24 releases; running this one with --experimental-wasm-exnref also works.',
    )
  }
}

/**
 * Builds the boot function for one module loader.
 *
 * The loader is a parameter rather than an import because this package has two
 * of them - `load-artifact.ts` reads the file from disk under Node,
 * `fetch-artifact.ts` fetches it over HTTP in a browser - and the browser build
 * must not so much as mention `node:fs`. Passing the loader in is what keeps
 * the two entry points sharing this file instead of duplicating it.
 *
 * Each call closes over its own cache, so the module is booted at most once per
 * loader per process.
 */
export const createBootModule = (loadModule: ModuleLoader): (() => Promise<FormatFunction>) => {
  let bootPromise: Promise<FormatFunction> | undefined

  /**
   * Boots ktfmt compiled to wasm, resolving to the function it
   * exports. The module is compiled at most once per process; every later call
   * awaits the same promise.
   */
  return (): Promise<FormatFunction> => {
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
}
