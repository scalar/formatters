import { createFormat } from './format'
import { nodeVm } from './node-vm'

export type { ArtifactSource, BootVm, FormatFunction, FormatOptions, RubyFormatterVm } from './types'

/**
 * The Node entry point, wired to the VM that reads the wasm from disk. Browsers
 * resolve `index.browser.ts` instead, through the `browser` export condition -
 * this file is the one that may touch `node:` built-ins.
 */
export const format = createFormat(nodeVm)

export default format
