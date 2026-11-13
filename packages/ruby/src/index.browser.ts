import { createArtifactLoader } from './fetch-artifact'
import { createFormat } from './format'
import { createRbcop } from './rbcop'
import type { InitOptions } from './types'

export type {
  ArtifactSource,
  FormatFunction,
  FormatOptions,
  FormatSyncFunction,
  Formatters,
  InitFunction,
  InitOptions,
  RbcopBoot,
  RbcopCorrector,
} from './types'

// Written out literally, in the `new URL('…', import.meta.url)` form bundlers
// look for, so that the artifact is emitted as an asset.
const loader = createArtifactLoader({ defaultUrl: () => new URL('../rbcop_fmt.wasm.br', import.meta.url) })

const { format, formatSync, init: boot } = createFormat(createRbcop(loader.source))

/**
 * Points the package at its artifact and boots it.
 *
 * Two steps rather than one because the browser build has two: the loader has
 * to be told where the wasm is and fetch it, and the module then has to be
 * instantiated. Both are optional for `format`, which does them on demand, and
 * both are required before `formatSync` - so this awaits them together and a
 * caller only has to know about one call.
 */
const init = async (options?: InitOptions): Promise<void> => {
  await loader.init(options)
  await boot()
}

/**
 * The browser entry point, resolved through the `browser` export condition.
 *
 * `format` has the same signature and the same output as it does under Node -
 * it is the same rbcop, and the same `createFormat` around it. The only
 * difference is where the wasm comes from, and `init` is here for the cases
 * where that needs saying explicitly.
 *
 * `formatSync` is here too, after one `await init()`: the fetch is the one step
 * a browser cannot make synchronous.
 *
 * Booting compiles 16 MB of wasm, so run this in a worker rather than on the
 * main thread. Nothing here requires one, but a main-thread caller will see the
 * tab stall for the length of the first boot.
 */
export { format, formatSync, init }

export default format
