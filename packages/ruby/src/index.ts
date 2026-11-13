import { nodeArtifact } from './compile-artifact'
import { createFormat } from './format'
import { createRbcop } from './rbcop'

export type {
  ArtifactSource,
  FormatFunction,
  FormatOptions,
  FormatSyncFunction,
  Formatters,
  InitFunction,
  RbcopBoot,
  RbcopCorrector,
} from './types'

/**
 * The Node entry point, wired to the module read from disk. Browsers resolve
 * `index.browser.ts` instead, through the `browser` export condition - this
 * file is the one that may touch `node:` built-ins.
 *
 * Under Node every step is synchronous, so `formatSync` needs no `init()` and
 * `init` only moves the cold start to a moment of the caller's choosing.
 */
const { format, formatSync, init } = createFormat(createRbcop(nodeArtifact))

export { format, formatSync, init }

export default format
