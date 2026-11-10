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
   * The pass is rbcop, RuboCop 1.92.2 reimplemented in Rust and compiled to a
   * second wasm module, held to byte-identical output against the real
   * `rubocop` by this package's conformance test. It costs a few milliseconds
   * a file. Set this to `false` for syntax_tree on its own: the rbcop module is
   * then never loaded at all, which in a browser is a download saved.
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
   * not name - `{ 'Layout/IndentationWidth': { Width: 4 } }`. It is written as
   * the config file the pass loads, so anything a `.rubocop.yml` can say about
   * Layout cops belongs here, spelled exactly as that file spells it. Merging
   * is one level deep, so naming a cop replaces this package's entry for it
   * rather than adding to it - which is how you would put `Layout/LineLength`
   * back, should you want RuboCop rather than syntax_tree deciding line width.
   *
   * What it cannot do is load Ruby: ERB, remote `inherit_from` URLs, plugins
   * and custom cops need a Ruby to run, and there is none in the pass. A config
   * that asks for one is reported as an error.
   *
   * Ignored when `rubocop` is `false`, because then there is no RuboCop to
   * configure.
   */
  rubocopConfig?: Record<string, unknown>
}

/**
 * Supplies one compiled wasm module, however this environment gets hold of it.
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

/** A booted rbcop instance: the RuboCop Layout pass over one source. */
export type RbcopCorrector = {
  /**
   * Corrects every Layout offense in `source` under the `.rubocop.yml` text in
   * `config`, and returns the result. Throws when the pass cannot settle, when
   * the config is invalid, and when the result would not parse.
   */
  correct: (source: string, config: string) => string
}

/**
 * An rbcop instance's lifecycle, as `createRbcop` hands it over.
 *
 * There is no `recycle`, because rbcop does not leak. `peek` answers
 * `undefined` both before the first boot and after a trap, and `boot` then
 * instantiates a fresh one.
 */
export type RbcopBoot = {
  boot: () => Promise<RbcopCorrector>
  peek: () => RbcopCorrector | undefined
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
 * Boots both modules, so that `formatSync` can be called afterwards.
 *
 * Booting is instantiating the Ruby artifact and applying the syntax_tree
 * patches, and instantiating rbcop - the Ruby artifact carries syntax_tree
 * already loaded, so no gem is required at runtime.
 *
 * Optional for `format`, which boots on demand, and required exactly once before
 * the first `formatSync`. Awaiting it twice is harmless - the boot is cached, so
 * the second call resolves against the first. The browser build's `init` takes
 * an {@link InitOptions}, for pointing the package at its artifacts.
 *
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
 * Where the browser build finds one artifact. Every field is optional; the
 * default resolves the artifact relative to the module and expands it here.
 */
export type ArtifactOptions = {
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
 * Options for the browser build's `init`, which is the seam for telling the
 * package where its artifacts live.
 *
 * The top-level fields describe `ruby_fmt.wasm.br`, the syntax_tree artifact;
 * `rbcop` describes `rbcop_fmt.wasm.br`, the RuboCop pass.
 */
export type InitOptions = ArtifactOptions & {
  /** Where to find `rbcop_fmt.wasm.br`. Defaults to the `.br` beside this package. */
  rbcop?: ArtifactOptions
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
  /** CRuby (wasm) with syntax_tree already loaded. */
  vm: RubyVM
  /** The mutable contents map behind /work, so input can be written from JS. */
  workFiles: Map<string, File>
  /** The VM's wasm linear memory, watched so the VM can be recycled before it dies. */
  memory: WebAssembly.Memory
}
