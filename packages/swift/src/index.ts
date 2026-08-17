import { compileArtifact } from './compile-artifact'
import { createFormat } from './format'

export type { ArtifactSource, FormatFunction, FormatOptions, SwiftFormatModule } from './types'

/**
 * The Node entry point, wired to the artifact source that reads the wasm from
 * disk. Browsers resolve `index.browser.ts` instead, through the `browser`
 * export condition - this file is the one that may touch `node:` built-ins.
 */
export const format = createFormat(compileArtifact)

export default format
