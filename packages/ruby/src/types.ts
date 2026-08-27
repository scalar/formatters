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
   * Set it to `false` for syntax_tree on its own. What that saves is the pass:
   * a format with RuboCop costs two to three times what syntax_tree alone does.
   * It no longer saves any loading. RuboCop used to be required into the VM on
   * the first call that asked for it, at about nine seconds a VM and again
   * after every recycle; it is now baked into the artifact, so it is there
   * whether this is `true` or `false`.
   *
   * The order is fixed and matters. The two tools disagree, so whichever runs
   * last decides; RuboCop goes second, so RuboCop wins. It cannot go first,
   * because RuboCop corrects offenses within the line structure it is handed
   * and never reprints - on 116 files whose formatting differed only in line
   * breaking, RuboCop alone mapped none of them to a common result.
   */
  rubocop?: boolean
  /**
   * Extra `.rubocop.yml` entries, merged over the ones this package sets.
   *
   * The escape hatch, for the parts of RuboCop's configuration this type does
   * not name - `{ 'Layout/IndentationWidth': { Width: 4 } }`. It is written
   * into the guest as the config file RuboCop loads, so anything a
   * `.rubocop.yml` can say belongs here, spelled exactly as that file spells
   * it. Merging is one level deep, so naming a cop replaces this package's
   * entry for it rather than adding to it - which is how you would put
   * `Layout/LineLength` back, should you want RuboCop rather than syntax_tree
   * deciding line width.
   *
   * Ignored when `rubocop` is `false`, because then there is no RuboCop to
   * configure.
   */
  rubocopConfig?: Record<string, unknown>
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
 * Boots the VM, so that `formatSync` can be called afterwards.
 *
 * Booting is instantiating the artifact, applying the syntax_tree patches and
 * building the Layout cop set - the artifact carries syntax_tree and RuboCop
 * already loaded, so neither gem is required at runtime any more.
 *
 * Optional for `format`, which boots on demand, and required exactly once before
 * the first `formatSync`. Awaiting it twice is harmless - the boot is cached, so
 * the second call resolves against the first. The browser build's `init` takes
 * an {@link InitOptions} as well, for pointing the package at its artifact. *
 * For Ruby this is also the recovery call: `formatSync` refuses once the VM has
 * outgrown what a synchronous caller can clear, and awaiting this again replaces
 * it.
 */
export type InitFunction = (options?: InitFormatOptions) => Promise<void>

/**
 * What `init` can be told, beyond "get ready".
 *
 * Nothing, now. The one option here existed because `init` used to require
 * RuboCop into the VM and a synchronous caller had no later chance to decline
 * it - `formatSync` needs `init`, so skipping the call is not the opt-out it is
 * for `format`. The artifact carries RuboCop already, so there is no longer a
 * cost to decline.
 */
export type InitFormatOptions = {
  /**
   * Accepted and ignored.
   *
   * It used to decide whether `init` spent about nine seconds requiring RuboCop
   * into the VM. RuboCop is now baked into the wasm artifact, so it is loaded
   * before `init` is called and no value here can change that. Kept so callers
   * that pass it keep compiling and keep working; `format`'s and `formatSync`'s
   * own `rubocop: false` still skips the pass, which is the part that was ever
   * worth skipping per call.
   */
  rubocop?: boolean
}

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
export type InitOptions = InitFormatOptions & {
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
  /** CRuby (wasm) with syntax_tree and RuboCop already loaded. */
  vm: RubyVM
  /** The mutable contents map behind /work, so input can be written from JS. */
  workFiles: Map<string, File>
  /** The VM's wasm linear memory, watched so the VM can be recycled before it dies. */
  memory: WebAssembly.Memory
}
