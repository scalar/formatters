import { createBootVm } from './boot-vm'
import { createArtifactLoader } from './fetch-artifact'
import { createFormat } from './format'
import { createRbcop } from './rbcop'
import type { InitOptions } from './types'

export type {
  ArtifactOptions,
  ArtifactSource,
  BootVm,
  FormatFunction,
  FormatOptions,
  FormatSyncFunction,
  Formatters,
  InitFunction,
  InitOptions,
  RbcopBoot,
  RbcopCorrector,
  RubyFormatterVm,
} from './types'

// Each URL is written out literally, in the `new URL('…', import.meta.url)` form
// bundlers look for, so that each artifact is emitted as an asset of its own.
const rubyLoader = createArtifactLoader({
  defaultUrl: () => new URL('../ruby_fmt.wasm.br', import.meta.url),
  label: 'syntax_tree',
})
const rbcopLoader = createArtifactLoader({
  defaultUrl: () => new URL('../rbcop_fmt.wasm.br', import.meta.url),
  label: 'rbcop',
})

const {
  format,
  formatSync,
  init: boot,
} = createFormat(createBootVm(rubyLoader.compileArtifact), createRbcop(rbcopLoader.compileArtifact))

/**
 * Points the package at its artifacts and boots both modules.
 *
 * Two steps rather than one because the browser build has two: the loaders
 * have to be told where the wasm is and fetch it, and the modules then have to
 * be booted. Both are optional for `format`, which does them on demand, and
 * both are required before `formatSync` - so this awaits them together and a
 * caller only has to know about one call.
 *
 * The top-level options describe the syntax_tree artifact and `rbcop` the
 * RuboCop pass, so an existing `init({ url })` keeps meaning what it meant.
 *
 * This is also what a `formatSync` caller comes back to when the VM has grown
 * too large to keep going synchronously.
 */
const init = async (options: InitOptions = {}): Promise<void> => {
  const { rbcop, ...ruby } = options
  await Promise.all([rubyLoader.init(ruby), rbcopLoader.init(rbcop)])
  await boot()
}

/**
 * The browser entry point, resolved through the `browser` export condition.
 *
 * `format` has the same signature and the same output as it does under Node -
 * it is the same syntax_tree on the same CRuby, the same rbcop, and the same
 * `createFormat` around them. The only difference is where the wasm comes from,
 * and `init` is here for the cases where that needs saying explicitly.
 *
 * `formatSync` is here too, with one caveat unique to this package: recycling
 * the VM is asynchronous, so a long synchronous run has to `await init()` again
 * when it says so. See `formatSync` in `format.ts`.
 *
 * Run this in a worker. Booting compiles two large wasm modules, and formatting
 * leaks the Ruby VM's linear memory until it is recycled - a tab has far less
 * room to absorb that than a server does.
 */
export { format, formatSync, init }

export default format
