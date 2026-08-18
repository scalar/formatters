import { createArtifactLoader } from './fetch-artifact'
import { createFormat } from './format'
import type { InitOptions } from './types'

export type {
  BootModule,
  FormatFunction,
  FormatOptions,
  Formatter,
  FormatterSync,
  Formatters,
  InitOptions,
  ModuleExports,
  RuntimeSource,
} from './types'

const loader = createArtifactLoader()
const { format, formatSync, init: bootRuntime } = createFormat(loader.source)

/**
 * Points the package at its assets and boots the runtime.
 *
 * Two steps rather than one because the browser build has two: the loader has to
 * be told where the archive and the runtime files are and fetch them, and the
 * .NET runtime then has to start. Both are optional for `format`, which does
 * them on demand, and both are required before `formatSync` - so this awaits
 * them together and a caller only has to know about one call.
 */
const init = async (options?: InitOptions): Promise<void> => {
  await loader.init(options)
  await bootRuntime()
}

/**
 * The browser entry point, resolved through the `browser` export condition.
 *
 * `format` has the same signature and the same output as it does under Node -
 * it is the same CSharpier on the same Mono-on-wasm runtime, and the same
 * `createFormat` around it. The only difference is where the assets come from,
 * and `init` is here for the cases where that needs saying explicitly.
 *
 * `formatSync` is here too, for callers whose seams cannot await. It needs
 * `await init()` first, which is the one thing booting can never avoid.
 *
 * This one carries more moving parts than the other browser builds: 4.2MB of
 * archive over the wire, 21MB of assemblies and ICU data behind it, and four
 * JavaScript files the runtime imports as ES modules by URL rather than taking
 * as bytes. Those four resolve next to this module by default, which is the
 * form Vite, Rollup and webpack emit as an asset unaided;
 * `init({ runtimeBaseUrl })` is for the setups where they end up somewhere else.
 *
 * Run it in a worker. Booting is ~1s of decompression, module loading and
 * Roslyn warm-up, which is a visibly frozen tab on the main thread.
 */
export { format, formatSync, init }

export default format
