import { createFormat } from './format'
import { loadModule } from './load-artifact'
import { ktfmtVersion } from './version'

export type {
  BootModule,
  FormatFunction,
  FormatOptions,
  Formatter,
  FormatterSync,
  Formatters,
  InitFunction,
  ModuleLoader,
} from './types'

/**
 * The Node entry point, wired to the loader that reads the wasm from disk.
 * Browsers resolve `index.browser.ts` instead, through the `browser` export
 * condition - this file is the one that may touch `node:` built-ins.
 */
const { format, formatSync, init } = createFormat(loadModule)

export { format, formatSync, init, ktfmtVersion }

export default format
