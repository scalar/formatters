import { createArtifactLoader } from './fetch-artifact'
import { createFormat } from './format'

export type { ArtifactSource, FormatFunction, FormatOptions, InitOptions, SwiftFormatModule } from './types'

const { compileArtifact, init } = createArtifactLoader()

/**
 * The browser entry point, resolved through the `browser` export condition.
 *
 * `format` has the same signature and the same output as it does under Node -
 * it is the same swift-format, and the same `createFormat` around it. The only
 * difference is where the wasm comes from, and `init` is here for the cases
 * where that needs saying explicitly.
 *
 * This is the largest artifact in the repo by a wide margin: 12.4MB over the
 * wire, 48.7MB of wasm to compile, and ~75MB of linear memory once warm. Run it
 * in a worker, and load it behind an explicit user action rather than on page
 * load - `init` exists partly so that download can be scheduled deliberately.
 */
export const format = createFormat(compileArtifact)

export { init }

export default format
