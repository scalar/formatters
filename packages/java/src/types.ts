/**
 * Options accepted by `format`. Each one mirrors a google-java-format CLI flag,
 * and every default is the tool's own default rather than one we picked - the
 * package is the tool, so `format(source)` has to mean `google-java-format
 * <file>`.
 */
export type FormatOptions = {
  /**
   * Which style to use. `google` is 2-space indent at 100 columns; `aosp` is
   * 4-space indent at 100 columns, the tool's `--aosp` flag.
   */
  style?: 'google' | 'aosp'
  /** Sort imports. The tool's `--skip-sorting-imports` turns this off. */
  sortImports?: boolean
  /** Remove unused imports. The tool's `--skip-removing-unused-imports`. */
  removeUnusedImports?: boolean
  /** Reflow string literals past the margin. The tool's `--skip-reflowing-long-strings`. */
  reflowLongStrings?: boolean
}

/**
 * The function JavaFmt.main parks on globalThis at boot.
 *
 * Both arguments are strings because that is what survives the boundary
 * cheaply: the second is an encoded option spec rather than an object, since
 * reading typed fields out of a JSObject costs more Java code than parsing four
 * values. The result carries a leading status character - see `format`.
 */
export type FormatFunction = (source: string, options: string) => string

/**
 * TeaVM's generated runtime module, whose `load` compiles and instantiates the
 * wasm. It ships beside the artifact as `java_fmt.runtime.mjs` and is exported
 * from this package as `./runtime`.
 */
export type Runtime = {
  load: (source: ArrayBuffer, options: Record<string, unknown>) => Promise<{ exports: Record<string, unknown> }>
}

/**
 * Supplies the module's exports, however this environment gets hold of the wasm.
 *
 * There are two implementations - one reads the artifact from disk, one fetches
 * it - and each caches the loaded module itself, so this is called once per boot
 * rather than once per format.
 */
export type ModuleLoader = () => Promise<Record<string, unknown>>

/** What `createFormat` returns, and what every entry point exports as `format`. */
export type Formatter = (source: string, options?: FormatOptions) => Promise<string>

/**
 * Options for the browser build's `init`, which is the seam for telling the
 * package where its artifact lives. Every field is optional; the defaults
 * resolve `java_fmt.wasm.br` relative to the module and expand it here.
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
