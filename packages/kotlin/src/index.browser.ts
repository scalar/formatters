import { createArtifactLoader } from './fetch-artifact'
import { createFormat } from './format'
import type { InitOptions } from './types'
import { ktfmtVersion } from './version'

export type {
  BootModule,
  FormatFunction,
  FormatOptions,
  Formatter,
  FormatterSync,
  Formatters,
  InitFunction,
  InitOptions,
  ModuleLoader,
} from './types'

const loader = createArtifactLoader()
const { format, formatSync, init: bootModule } = createFormat(loader.loadModule)

/**
 * Points the package at its artifact and boots it.
 *
 * Two steps rather than one because the browser build has two: the loader has to
 * be told where the wasm is and fetch it, and the module then has to be loaded.
 * Both are optional for `format`, which does them on demand, and both are
 * required before `formatSync` - so this awaits them together and a caller only
 * has to know about one call.
 */
const init = async (options?: InitOptions): Promise<void> => {
  await loader.init(options)
  await bootModule()
}

/**
 * The browser entry point, resolved through the `browser` export condition.
 *
 * `format` has the same signature and the same output as it does under Node -
 * it is the same ktfmt, and the same `createFormat` around it. The only
 * difference is where the wasm comes from, and `init` is here for the cases
 * where that needs saying explicitly.
 *
 * `formatSync` is here too, for callers whose seams cannot await. It needs
 * `await init()` first, which is the one thing booting can never avoid.
 *
 * The engine floor is real and is checked at boot: the module uses the final
 * wasm exception-handling opcodes, which means Chrome 137, Firefox 131 or
 * Safari 18.4 at the earliest.
 */
export { format, formatSync, init, ktfmtVersion }

export default format
