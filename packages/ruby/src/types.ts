import type { File } from '@bjorn3/browser_wasi_shim'
import type { RubyVM } from '@ruby/wasm-wasi'

/**
 * Options accepted by `format`.
 *
 * `printWidth` mirrors a syntax_tree option, so its default is syntax_tree's
 * rather than one we picked. `rubocop` turns on a second pass and is ours.
 */
export type FormatOptions = {
  /** Maximum line width. syntax_tree's default is 80. */
  printWidth?: number
  /**
   * Run `rubocop --autocorrect --only Layout` over syntax_tree's output.
   *
   * **On by default.** syntax_tree alone leaves Layout offenses in about 30% of
   * real files - mostly multiline operation and method-call indentation, where
   * the two tools genuinely disagree - so without this pass, formatted output
   * can still fail a consumer's own `rubocop` run. Formatting that a linter
   * rejects is not finished, so clearing it is the default rather than an
   * opt-in.
   *
   * Set it to `false` for syntax_tree on its own. That is worth doing when
   * neither cost below is worth paying: the first call into a VM requires
   * RuboCop, which takes roughly four seconds - 698 cop files, read and
   * evaluated by a Ruby that is itself running on WebAssembly - and each format
   * afterwards costs two to three times what syntax_tree alone does. Both are
   * per VM, so they are paid again after a recycle. Opting out skips all of it:
   * RuboCop is never loaded at all.
   *
   * The order is fixed and matters. The two tools disagree, so whichever runs
   * last decides; RuboCop goes second, so RuboCop wins. It cannot go first,
   * because RuboCop corrects offenses within the line structure it is handed
   * and never reprints - on 116 files whose formatting differed only in line
   * breaking, RuboCop alone mapped none of them to a common result.
   */
  rubocop?: boolean
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
  peek: () => RubyFormatterVm | undefined
  recycle: () => Promise<RubyFormatterVm>
}

/** The package's asynchronous entry point, exported by both builds as `format`. */
export type FormatFunction = (source: string, options?: FormatOptions) => Promise<string>

/**
 * The package's synchronous entry point, exported by both builds as `formatSync`.
 *
 * Usable only once `init` has resolved, and - uniquely in this repo - only until
 * the VM's linear memory passes the ceiling a synchronous caller cannot clear.
 * See `formatSync` in `format.ts` for why Ruby is the exception.
 */
export type FormatSyncFunction = (source: string, options?: FormatOptions) => string

/**
 * Boots the VM and loads RuboCop into it, so that `formatSync` can be called
 * afterwards.
 *
 * RuboCop is loaded here rather than on first use because it is the default
 * pass and requiring it is synchronous - left to `formatSync`, that first call
 * would stall for four seconds in a caller that cannot wait at all. A caller
 * who only ever passes `rubocop: false` should skip this and let `format` boot
 * on its own, which never loads RuboCop.
 *
 * Optional for `format`, which boots on demand, and required exactly once before
 * the first `formatSync`. Awaiting it twice is harmless - the boot is cached, so
 * the second call resolves against the first. The browser build's `init` takes
 * an {@link InitOptions} as well, for pointing the package at its artifact. *
 * For Ruby this is also the recovery call: `formatSync` refuses once the VM has
 * outgrown what a synchronous caller can clear, and awaiting this again replaces
 * it.
 */
export type InitFunction = () => Promise<void>

/** What `createFormat` returns: the package's public functions over one VM. */
export type Formatters = {
  format: FormatFunction
  formatSync: FormatSyncFunction
  init: InitFunction
}

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
  /**
   * Whether RuboCop has been required into this VM yet.
   *
   * Mutable, and deliberately per VM rather than per module: requiring RuboCop
   * is expensive enough to want caching, and a recycled VM has not done it,
   * so a module-level flag would leave `format` calling into a constant that
   * the new VM has never heard of.
   */
  rubocopLoaded: boolean
}
