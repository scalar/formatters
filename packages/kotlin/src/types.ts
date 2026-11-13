/**
 * Options accepted by `format` and `formatSync`.
 *
 * Every default is ktfmt's own rather than one we picked: `format(source)`
 * has to mean `ktfmt <file>`. That includes the style - ktfmt's help says "If
 * none of the style options are passed, Meta's style is used."
 *
 * The three styles differ only in indentation and trailing commas, and each
 * field below overrides whichever style is in effect.
 */
export type FormatOptions = {
  /**
   * Which style to use, matching ktfmt's `--meta-style`, `--google-style` and
   * `--kotlinlang-style` flags.
   *
   * `meta` is 2-space blocks with 4-space continuations and only ever adds
   * trailing commas; `google` is 2 and 2; `kotlinlang` is 4 and 4. Both of the
   * latter manage trailing commas completely, which means removing redundant
   * ones as well as adding them.
   */
  style?: 'meta' | 'google' | 'kotlinlang'
  /** Column ktfmt breaks lines at. 100 in every style. */
  maxWidth?: number
  /** Indent for an opened block, in spaces. */
  blockIndent?: number
  /** Indent for a line broken because it was too long, in spaces. */
  continuationIndent?: number
  /**
   * How trailing commas are handled: leave them alone, only add them, or also
   * remove redundant ones.
   */
  trailingCommas?: 'none' | 'onlyAdd' | 'complete'
  /** Remove imports that are not used. On in every style. */
  removeUnusedImports?: boolean
  /**
   * Keep a lambda multi-line when it was written multi-line. On in every style.
   * Turning it off lets ktfmt collapse a lambda that would now fit.
   */
  preserveLambdaBreaks?: boolean
}

/**
 * Supplies the compiled module, however this environment gets hold of it.
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

/** A booted instance of the module: the formatter over one source. */
export type KotlinFormatter = {
  /** Formats `source`, throwing ktfmt's diagnostic on source it cannot parse. */
  format: (source: string, options: FormatOptions) => string
}

/**
 * An instance's lifecycle, as `createKotlinFormatter` hands it over.
 *
 * There is no `recycle`, because the module does not leak. The one thing that
 * ends an instance is a trap, after which either call instantiates a fresh one.
 */
export type KotlinFormatterBoot = {
  /** The instance, instantiated on demand. */
  boot: () => Promise<KotlinFormatter>
  /**
   * The instance without awaiting, or `undefined` where the module has not been
   * fetched yet - a browser before `init`.
   */
  bootSync: () => KotlinFormatter | undefined
}

/** The package's asynchronous entry point, exported by both builds as `format`. */
export type Formatter = (source: string, options?: FormatOptions) => Promise<string>

/**
 * The package's synchronous entry point, exported by both builds as `formatSync`.
 *
 * Under Node it needs nothing first. In a browser it needs `await init()` once,
 * because the artifact has to be fetched and nothing can wait on a fetch
 * synchronously.
 */
export type FormatterSync = (source: string, options?: FormatOptions) => string

/**
 * Boots the module ahead of the first format.
 *
 * Optional under Node, where both `format` and `formatSync` boot on demand;
 * awaiting it only moves the cold start to a moment of the caller's choosing.
 * Required in a browser before the first `formatSync`. Awaiting it twice is
 * harmless. The browser build's `init` takes an {@link InitOptions}, for
 * pointing the package at its artifact.
 */
export type InitFunction = () => Promise<void>

/** What `createFormat` returns: the package's public functions over one module. */
export type Formatters = {
  format: Formatter
  formatSync: FormatterSync
  init: InitFunction
}

/**
 * Options for the browser build's `init`, which is the seam for telling the
 * package where its artifact lives. Every field is optional; the defaults
 * resolve `kotlin_fmt.wasm.br` relative to the module and expand it here.
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
