/**
 * Options accepted by `format`.
 *
 * Every field here is a real rustfmt configuration key, spelled the way a
 * `rustfmt.toml` spells it, because that is what these become: they are handed
 * to rustfmt's own `Config::override_value`, the same code path as
 * `rustfmt --config key=value`. Anything left out keeps rustfmt's default
 * rather than one we picked - there is no second copy of the defaults on this
 * side to fall out of step.
 *
 * This is the stable, widely useful part of rustfmt's configuration, not all of
 * it. `config` is the escape hatch for the rest, including the nightly-only
 * options.
 */
export type FormatOptions = {
  /** Maximum width of each line. rustfmt's default is 100. */
  maxWidth?: number
  /** Number of spaces per tab. Default 4. */
  tabSpaces?: number
  /** Indent with hard tabs rather than spaces. Default false. */
  hardTabs?: boolean
  /**
   * The style edition, which selects the formatting rules as a set - see
   * RFC 3338. Default "2015". This is the option most likely to change output
   * wholesale, because it decides what every other default is.
   */
  styleEdition?: '2015' | '2018' | '2021' | '2024'
  /** The edition of the source being parsed. Default "2015". */
  edition?: '2015' | '2018' | '2021' | '2024'
  /** Line ending style. Default "Auto". */
  newlineStyle?: 'Auto' | 'Windows' | 'Unix' | 'Native'
  /** Whether to reorder and group `use` declarations. Default true. */
  reorderImports?: boolean
  /** Whether to reorder `mod` declarations. Default true. */
  reorderModules?: boolean
  /** Remove nested parens. Default true. */
  removeNestedParens?: boolean
  /** Merge or split imports. Default "Preserve". */
  importsGranularity?: 'Preserve' | 'Crate' | 'Module' | 'Item' | 'One'
  /** Where to put the `where` clause. Default "Default". */
  whereSingleLine?: boolean
  /** Convert `#[doc]` attributes to `///` doc comments. Default false. */
  normalizeDocAttributes?: boolean
  /** Break comments to fit within `maxWidth`. Default false (nightly-only in rustfmt). */
  wrapComments?: boolean
  /** Format code snippets inside doc comments. Default false (nightly-only in rustfmt). */
  formatCodeInDocComments?: boolean
  /** Format string literals that exceed the width. Default false (nightly-only in rustfmt). */
  formatStrings?: boolean
  /**
   * Any rustfmt configuration key, by its own snake_case name, for options this
   * type does not name - `{ 'fn_call_width': 80 }`. Values are stringified the
   * way rustfmt's `--config` expects them. Keys here win over the typed fields
   * above, so this is also the way to override one.
   */
  config?: Record<string, string | number | boolean>
}

/**
 * Supplies the compiled wasm module, however this environment gets hold of it.
 *
 * There are two implementations - one reads the artifact from disk, one fetches
 * it - and each caches the compiled module itself, so this is called once per
 * boot rather than once per format.
 */
export type ArtifactSource = () => Promise<WebAssembly.Module>

/** The package's asynchronous entry point, exported by both builds as `format`. */
export type FormatFunction = (source: string, options?: FormatOptions) => Promise<string>

/**
 * The package's synchronous entry point, exported by both builds as `formatSync`.
 *
 * Usable only once `init` has resolved, because booting cannot be made
 * synchronous - the wasm has to be read or fetched, and compiled - and throws
 * with that instruction until then.
 */
export type FormatSyncFunction = (source: string, options?: FormatOptions) => string

/**
 * Boots the module, so that `formatSync` can be called afterwards.
 *
 * Optional for `format`, which boots on demand, and required exactly once before
 * the first `formatSync`. Awaiting it twice is harmless - the boot is cached, so
 * the second call resolves against the first. The browser build's `init` takes
 * an {@link InitOptions} as well, for pointing the package at its artifact.
 */
export type InitFunction = () => Promise<void>

/** What `createFormat` returns: the package's public functions over one artifact source. */
export type Formatters = {
  format: FormatFunction
  formatSync: FormatSyncFunction
  init: InitFunction
}

/**
 * The instance lifecycle `createBootModule` hands back.
 *
 * `peek` is what makes a synchronous format possible: it answers "is the module
 * ready" without an await, so a synchronous caller can be told to init rather
 * than being handed a promise it cannot use. `recycle` returns the replacement
 * so a trap can be recovered from on the same synchronous path.
 */
export type BootModule = {
  boot: () => Promise<RustFormatModule>
  peek: () => RustFormatModule | undefined
  recycle: () => RustFormatModule | undefined
}

/**
 * Options for the browser build's `init`, which is the seam for telling the
 * package where its artifact lives. Every field is optional; the defaults
 * resolve `rust_fmt.wasm.br` relative to the module and expand it here.
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
 * The module's `run` export, plus the handles a format needs around it.
 *
 * `run` takes no arguments and returns a status code: source, configuration and
 * result all cross through the preopened `/work` directory rather than through
 * linear memory, so there is nothing to pass. See
 * build/rust_fmt/crates/rust_fmt/src/lib.rs for what each status means.
 */
export type RustFormatModule = {
  /** Formats `/work/input.rs` into `/work/output.rs`, returning a status. */
  run: () => number
  /** The `/work` directory's contents, mutated between calls to hand input over and take output back. */
  workFiles: Map<string, unknown>
  /** Lines the module wrote to stderr during the current call, cleared before each one. */
  diagnostics: string[]
}
