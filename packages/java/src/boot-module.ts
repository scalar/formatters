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

let bootPromise: Promise<FormatFunction> | undefined

/** Fails loudly on a runtime where the module would hang, or not compile at all. */
const checkRuntime = (): void => {
  const major = Number.parseInt(process.versions.node ?? '0', 10)
  if (major < MINIMUM_NODE_MAJOR) {
    throw new Error(
      `@scalar/java-fmt needs Node ${MINIMUM_NODE_FOR_EXNREF} or newer (this is ${process.version}). ` +
        "Older versions format correctly but V8's wasm optimizer then consumes memory until the " +
        'process is killed, so it would never exit.',
    )
  }

  if (!supportsExnref()) {
    throw new Error(
      `@scalar/java-fmt needs Node ${MINIMUM_NODE_FOR_EXNREF} or newer (this is ${process.version}). ` +
        'The module uses the final wasm exception-handling opcodes, which V8 rejects on earlier ' +
        'Node 24 releases; running this one with --experimental-wasm-exnref also works.',
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
