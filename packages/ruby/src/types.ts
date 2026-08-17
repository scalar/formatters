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
 * Supplies the compiled wasm module, however this environment gets hold of it.
 *
 * There are two implementations - one reads the artifact from disk, one fetches
 * it - and each caches the compiled module itself, so this is called once per
 * boot rather than once per format.
 */
export type ArtifactSource = () => Promise<WebAssembly.Module>

/**
 * A booted VM's lifecycle, as `createBootVm` hands it over.
 *
 * `createFormat` takes this rather than an `ArtifactSource` because the VM has
 * to be shared, not just its artifact: the recycling test watches the very VM
 * that `format` uses, and two closures over one artifact source would boot two.
 */
export type BootVm = {
  boot: () => Promise<RubyFormatterVm>
  recycle: () => Promise<RubyFormatterVm>
}

/** What `createFormat` returns, and what every entry point exports as `format`. */
export type FormatFunction = (source: string, options?: FormatOptions) => Promise<string>

/**
 * Options for the browser build's `init`, which is the seam for telling the
 * package where its artifact lives. Every field is optional; the defaults
 * resolve `ruby_fmt.wasm.br` relative to the module and expand it here.
 */
export type InitOptions = {
  /** Where to fetch the artifact from. Defaults to the `.br` beside this package. */
  url?: string | URL
  /** The artifact itself, already in hand. Skips the fetch entirely. */
  bytes?: ArrayBuffer | ArrayBufferView
  /**
   * How the bytes at `url` are encoded. Defaults to `brotli`, matching the
   * committed artifact. Use `none` when the server sets `Content-Encoding: br`
   * - the browser will have expanded it before this package sees it - or when
   * `url` points at an uncompressed `.wasm`. Either skips the decoder, and with
   * it the 208KB download on engines without native brotli.
   */
  encoding?: 'brotli' | 'none'
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
