import { compileArtifact } from './compile-artifact'
import { createFormat } from './format'

export type {
  ArtifactSource,
  BootModule,
  FormatFunction,
  FormatOptions,
  FormatSyncFunction,
  Formatters,
  InitFunction,
  RustFormatModule,
} from './types'

/**
 * The Node entry point, wired to the artifact source that reads the wasm from
 * disk. Browsers resolve `index.browser.ts` instead, through the `browser`
 * export condition - this file is the one that may touch `node:` built-ins.
 */
const { format, formatSync, init } = createFormat(compileArtifact)

export { format, formatSync, init }

export default format
