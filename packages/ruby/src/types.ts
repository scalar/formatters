import type { File } from '@bjorn3/browser_wasi_shim'
import type { RubyVM } from '@ruby/wasm-wasi'

/**
 * Options accepted by `format`. Everything here mirrors a syntax_tree option,
 * so the defaults are syntax_tree's defaults rather than ones we picked.
 */
export type FormatOptions = {
  /** Maximum line width. syntax_tree's default is 80. */
  printWidth?: number
}

/**
 * A booted Ruby VM together with the two handles formatting needs to reach
 * into it.
 *
 * `workFiles` and `memory` are not conveniences: input is handed to Ruby by
 * writing into the guest filesystem, and the VM has to be watched because
 * formatting leaks its linear memory (see `boot-vm.ts`). Both belong to a
 * specific VM instance, so they travel with it rather than living in module
 * state that a recycle could leave pointing at a dead VM.
 */
export type RubyFormatterVm = {
  /** CRuby (wasm) with syntax_tree already required. */
  vm: RubyVM
  /** The mutable contents map behind /work, so input can be written from JS. */
  workFiles: Map<string, File>
  /** The VM's wasm linear memory, watched so the VM can be recycled before it dies. */
  memory: WebAssembly.Memory
}
