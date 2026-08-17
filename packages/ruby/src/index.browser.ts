import { createBootVm } from './boot-vm'
import { createArtifactLoader } from './fetch-artifact'
import { createFormat } from './format'

export type { ArtifactSource, BootVm, FormatFunction, FormatOptions, InitOptions, RubyFormatterVm } from './types'

const { compileArtifact, init } = createArtifactLoader()

/**
 * The browser entry point, resolved through the `browser` export condition.
 *
 * `format` has the same signature and the same output as it does under Node -
 * it is the same syntax_tree on the same CRuby, and the same `createFormat`
 * around it. The only difference is where the wasm comes from, and `init` is
 * here for the cases where that needs saying explicitly.
 *
 * Run this in a worker. Booting compiles 20MB of wasm, and formatting leaks the
 * VM's linear memory until it is recycled at 400MB - a ceiling chosen for a
 * Node process, where holding the outgoing and incoming buffers at once peaks
 * near 1GB. A tab has far less room to absorb that than a server does, so a
 * browser caller formatting large files should expect the recycle to be
 * noticeable and should not be doing it on the main thread.
 */
export const format = createFormat(createBootVm(compileArtifact))

export { init }

export default format
