import { createArtifactLoader } from './fetch-artifact'
import { createFormat } from './format'

export type { FormatFunction, FormatOptions, Formatter, InitOptions, ModuleExports, RuntimeSource } from './types'

const { source, init } = createArtifactLoader()

/**
 * The browser entry point, resolved through the `browser` export condition.
 *
 * `format` has the same signature and the same output as it does under Node -
 * it is the same CSharpier on the same Mono-on-wasm runtime, and the same
 * `createFormat` around it. The only difference is where the assets come from,
 * and `init` is here for the cases where that needs saying explicitly.
 *
 * This one carries more moving parts than the other browser builds: 4.2MB of
 * archive over the wire, 21MB of assemblies and ICU data behind it, and four
 * JavaScript files the runtime imports as ES modules by URL rather than taking
 * as bytes. Those four resolve next to this module by default, which is the
 * form every major bundler emits as an asset unaided; `init({ runtimeBaseUrl })`
 * is for the setups where they end up somewhere else.
 *
 * Run it in a worker. Booting is ~1s of decompression, module loading and
 * Roslyn warm-up, which is a visibly frozen tab on the main thread.
 */
export const format = createFormat(source)

export { init }

export default format
