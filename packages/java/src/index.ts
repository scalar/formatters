import { createFormat } from './format'
import { loadModule } from './load-artifact'

export type { FormatFunction, FormatOptions, Formatter, ModuleLoader } from './types'

/**
 * The Node entry point, wired to the loader that reads the wasm from disk.
 * Browsers resolve `index.browser.ts` instead, through the `browser` export
 * condition - this file is the one that may touch `node:` built-ins.
 */
export const format = createFormat(loadModule)

export default format
