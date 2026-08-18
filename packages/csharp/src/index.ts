import { createFormat } from './format'
import { nodeRuntimeSource } from './load-artifact'

export type {
  BootModule,
  FormatFunction,
  FormatOptions,
  Formatter,
  FormatterSync,
  Formatters,
  InitFunction,
  ModuleExports,
  RuntimeSource,
} from './types'

/**
 * The Node entry point, wired to the runtime source that reads from disk.
 * Browsers resolve `index.browser.ts` instead, through the `browser` export
 * condition - this file is the one that may touch `node:` built-ins.
 */
const { format, formatSync, init } = createFormat(nodeRuntimeSource)

export { format, formatSync, init }

export default format
