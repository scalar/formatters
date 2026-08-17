import { createArtifactLoader } from './fetch-artifact'
import { createFormat } from './format'

export type { FormatFunction, FormatOptions, Formatter, InitOptions, ModuleLoader } from './types'

const { loadModule, init } = createArtifactLoader()

/**
 * The browser entry point, resolved through the `browser` export condition.
 *
 * `format` has the same signature and the same output as it does under Node -
 * it is the same ktfmt, and the same `createFormat` around it. The only
 * difference is where the wasm comes from, and `init` is here for the cases
 * where that needs saying explicitly.
 *
 * This is one of the smaller artifacts in the repo: 0.91MB over the wire,
 * 3.8MB of WasmGC to compile. It still wants a worker rather than the main
 * thread, but it is the one most comfortable in a page.
 *
 * The engine floor is real and is checked at boot: the module uses the final
 * wasm exception-handling opcodes, which means Chrome 137, Firefox 131 or
 * Safari 18.4 at the earliest.
 */
export const format = createFormat(loadModule)

export { init }

export default format
