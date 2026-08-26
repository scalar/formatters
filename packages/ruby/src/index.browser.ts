import { createBootVm } from './boot-vm'
import { createArtifactLoader } from './fetch-artifact'
import { createFormat } from './format'
import type { InitOptions } from './types'

export type {
  ArtifactSource,
  BootVm,
  FormatFunction,
  FormatOptions,
  FormatSyncFunction,
  Formatters,
  InitFormatOptions,
  InitFunction,
  InitOptions,
  RubyFormatterVm,
} from './types'

const loader = createArtifactLoader()
const { format, formatSync, init: bootVm } = createFormat(createBootVm(loader.compileArtifact, loader.loadSnapshot))

/**
 * Points the package at its artifact and boots the VM.
 *
 * Two steps rather than one because the browser build has two: the loader has to
 * be told where the wasm is and fetch it, and the VM then has to be booted. Both
 * are optional for `format`, which does them on demand, and both are required
 * before `formatSync` - so this awaits them together and a caller only has to
 * know about one call.
 *
 * This is also what a `formatSync` caller comes back to when the VM has grown
 * too large to keep going synchronously.
 */
const init = async (options?: InitOptions): Promise<void> => {
  await loader.init(options)
  await bootVm(options)
}

/**
 * The browser entry point, resolved through the `browser` export condition.
 *
 * `format` has the same signature and the same output as it does under Node -
 * it is the same syntax_tree on the same CRuby, and the same `createFormat`
 * around it. The only difference is where the wasm comes from, and `init` is
 * here for the cases where that needs saying explicitly.
 *
 * `formatSync` is here too, with one caveat unique to this package: recycling
 * the VM is asynchronous, so a long synchronous run has to `await init()` again
 * when it says so. See `formatSync` in `format.ts`.
 *
 * Run this in a worker. Booting compiles 20MB of wasm, and formatting leaks the
 * VM's linear memory until it is recycled - a tab has far less room to absorb
 * that than a server does.
 */
export { format, formatSync, init }

export default format
