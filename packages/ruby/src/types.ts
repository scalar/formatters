/**
 * Options accepted by `format` and `formatSync`.
 *
 * Both are RuboCop configuration in the end: `printWidth` is a shorthand for
 * the one Layout setting nearly every caller wants to name, and `rubocopConfig`
 * is everything else.
 */
export type FormatOptions = {
  /**
   * Maximum line length, as `Layout/LineLength`'s `Max`. Defaults to 120,
   * RuboCop's own default, so that with no options at all the output is what
   * stock `rubocop --autocorrect --only Layout` writes.
   *
   * This is a cop's limit, not a printer's width. RuboCop does not reprint, so
   * the only lines it shortens are ones it can break at an argument list or a
   * collection literal; a long lambda, a long constant assignment or a long
   * string literal stays as long as it was.
   *
   * Ignored when `rubocopConfig` names `Layout/LineLength` itself - the caller's
   * entry for the cop wins over this shorthand for it.
   */
  printWidth?: number
  /**
   * Extra `.rubocop.yml` entries, merged over the ones this package sets.
   *
   * The escape hatch, for the parts of RuboCop's configuration this type does
   * not name - `{ 'Layout/IndentationWidth': { Width: 4 } }`. It is written as
   * the config file the pass loads, so anything a `.rubocop.yml` can say about
   * Layout cops belongs here, spelled exactly as that file spells it. Merging
   * is one level deep, so naming a cop replaces this package's entry for it
   * rather than adding to it - which is how `Layout/LineLength` here takes over
   * from `printWidth`.
   *
   * What it cannot do is load Ruby: ERB, remote `inherit_from` URLs, plugins
   * and custom cops need a Ruby to run, and there is none in the pass. A config
   * that asks for one is reported as an error.
   */
  rubocopConfig?: Record<string, unknown>
}

/**
 * Supplies the compiled rbcop module, however this environment gets hold of it.
 *
 * There are two implementations - one reads the artifact from disk, one fetches
 * it - and each caches the compiled module itself, so a recovered trap
 * re-instantiates rather than re-reading anything.
 */
export type ArtifactSource = {
  /** The compiled module, read or fetched on the first call. */
  compile: () => Promise<WebAssembly.Module>
  /**
   * The compiled module without awaiting, or `undefined` where it cannot be had
   * without awaiting.
   *
   * Under Node this always answers - it reads, decompresses and compiles
   * synchronously on the first call - which is what lets `formatSync` work with
   * no `init()`. In a browser it answers only once `compile` has resolved,
   * because a fetch cannot be waited on synchronously.
   */
  compileSync: () => WebAssembly.Module | undefined
}

/** A booted rbcop instance: the RuboCop Layout pass over one source. */
export type RbcopCorrector = {
  /**
   * Corrects every Layout offense in `source` under the `.rubocop.yml` text in
   * `config`, and returns the result. Throws when the source does not parse,
   * when the pass cannot settle, when the config is invalid, and when the
   * result would not parse.
   */
  correct: (source: string, config: string) => string
}

/**
 * An rbcop instance's lifecycle, as `createRbcop` hands it over.
 *
 * There is no `recycle`, because rbcop does not leak. The one thing that ends
 * an instance is a trap, after which either call instantiates a fresh one.
 */
export type RbcopBoot = {
  /** The instance, instantiated on demand. */
  boot: () => Promise<RbcopCorrector>
  /**
   * The instance without awaiting, instantiated on demand where the engine
   * allows it, or `undefined` where it does not - a browser before `init`, or a
   * browser main thread recovering from a trap, which refuses to instantiate a
   * module this size synchronously.
   */
  bootSync: () => RbcopCorrector | undefined
}

/** The package's asynchronous entry point, exported by both builds as `format`. */
export type FormatFunction = (source: string, options?: FormatOptions) => Promise<string>

/**
 * The package's synchronous entry point, exported by both builds as `formatSync`.
 *
 * Under Node it needs nothing first. In a browser it needs `await init()` once,
 * because the artifact has to be fetched and nothing can wait on a fetch
 * synchronously.
 */
export type FormatSyncFunction = (source: string, options?: FormatOptions) => string

/**
 * Boots rbcop ahead of the first format.
 *
 * Optional under Node, where both `format` and `formatSync` boot on demand;
 * awaiting it only moves the ~0.2 s cold start to a moment of the caller's
 * choosing. Required in a browser before the first `formatSync`. Awaiting it
 * twice is harmless. The browser build's `init` takes an {@link InitOptions},
 * for pointing the package at its artifact.
 */
export type InitFunction = () => Promise<void>

/** What `createFormat` returns: the package's public functions over one rbcop. */
export type Formatters = {
  format: FormatFunction
  formatSync: FormatSyncFunction
  init: InitFunction
}

/**
 * Options for the browser build's `init`: where to find `rbcop_fmt.wasm.br`.
 * Every field is optional; the default resolves the artifact relative to the
 * module and expands it here.
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
