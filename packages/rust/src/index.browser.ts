import { createArtifactLoader } from './fetch-artifact'
import { createFormat } from './format'

export type { ArtifactSource, FormatFunction, FormatOptions, InitOptions, RustFormatModule } from './types'

const { compileArtifact, init } = createArtifactLoader()

/**
 * The browser entry point, resolved through the `browser` export condition.
 *
 * `format` has the same signature and the same output as it does under Node -
 * it is the same rustfmt, and the same `createFormat` around it. The only
 * difference is where the wasm comes from, and `init` is here for the cases
 * where that needs saying explicitly.
 *
 * Formatting compiles ~6.2MB of wasm and holds ~35MB of linear memory, so run
 * this in a worker rather than on the main thread. Nothing here requires one -
 * it works either way - but a main-thread caller will see the tab stall for the
 * length of the first boot.
 */
export const format = createFormat(compileArtifact)

export { init }

export default format
