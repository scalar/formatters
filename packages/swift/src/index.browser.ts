import { createArtifactLoader } from './fetch-artifact'
import { createFormat } from './format'
import type { InitOptions } from './types'

export type {
  ArtifactSource,
  BootModule,
  FormatFunction,
  FormatOptions,
  FormatSyncFunction,
  Formatters,
  InitOptions,
  SwiftFormatModule,
} from './types'

const loader = createArtifactLoader()
const { format, formatSync, init: bootModule } = createFormat(loader.compileArtifact)

/**
 * Points the package at its artifact and boots it.
 *
 * Two steps rather than one because the browser build has two: the loader has to
 * be told where the wasm is and fetch it, and the module then has to be
 * instantiated. Both are optional for `format`, which does them on demand, and
 * both are required before `formatSync` - so this awaits them together and a
 * caller only has to know about one call.
 */
const init = async (options?: InitOptions): Promise<void> => {
  await loader.init(options)
  await bootModule()
}

/**
 * The browser entry point, resolved through the `browser` export condition.
 *
 * `format` has the same signature and the same output as it does under Node -
 * it is the same swift-format, and the same `createFormat` around it. The only
 * difference is where the wasm comes from, and `init` is here for the cases
 * where that needs saying explicitly.
 *
 * `formatSync` is here too, for callers whose seams cannot await. It needs
 * `await init()` first, which is the one thing booting can never avoid.
 *
 * This is the largest artifact in the repo by a wide margin: 12.4MB over the
 * wire, 48.7MB of wasm to compile, and ~75MB of linear memory once warm. Run it
 * in a worker, and load it behind an explicit user action rather than on page
 * load - `init` exists partly so that download can be scheduled deliberately.
 */
export { format, formatSync, init }

export default format
