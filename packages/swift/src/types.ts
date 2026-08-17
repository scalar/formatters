/**
 * Options accepted by `format`.
 *
 * Every field here is a key of swift-format's own `Configuration`, spelled the
 * same way it is spelled in a `.swift-format` file, because that is what these
 * become: the options are serialised to JSON and decoded by the real
 * `Configuration` type inside the module. Anything left out keeps swift-format's
 * default rather than one we picked - its decoder fills absent keys in itself,
 * so there is no second copy of the defaults on this side to fall out of step.
 *
 * This is not the whole of `Configuration`; it is the part that is stable and
 * useful from JavaScript. `rules` is the escape hatch for the rest.
 */
export type FormatOptions = {
  /** Maximum line length before the formatter breaks a line. swift-format's default is 100. */
  lineLength?: number
  /** Indentation width and kind. swift-format's default is 2 spaces. */
  indentation?: { spaces: number } | { tabs: number }
  /** How wide a tab is assumed to be when measuring a line. Default 8. */
  tabWidth?: number
  /** Consecutive blank lines allowed before they are collapsed. Default 1. */
  maximumBlankLines?: number
  /** Spaces before an end-of-line comment. Default 2. */
  spacesBeforeEndOfLineComments?: number
  /**
   * Whether line breaks the author already wrote are preserved where the
   * formatter would not have chosen them. Default true, and turning it off
   * changes a lot of output.
   */
  respectsExistingLineBreaks?: boolean
  /** Break before `else`, `catch` and friends rather than keeping them on the closing brace's line. Default false. */
  lineBreakBeforeControlFlowKeywords?: boolean
  /** Break before every argument when a call does not fit. Default false. */
  lineBreakBeforeEachArgument?: boolean
  /** Break before every generic requirement when a clause does not fit. Default false. */
  lineBreakBeforeEachGenericRequirement?: boolean
  /** Break between a declaration's attributes and the declaration. Default false. */
  lineBreakBetweenDeclarationAttributes?: boolean
  /** Keep a function's output type with its signature when breaking. Default false. */
  prioritizeKeepingFunctionOutputTogether?: boolean
  /** Indent the bodies of `#if` blocks. Default false. */
  indentConditionalCompilationBlocks?: boolean
  /** Indent `case` labels one level inside their `switch`. Default false. */
  indentSwitchCaseLabels?: boolean
  /** Put spaces around `...` and `..<`. Default false. */
  spacesAroundRangeFormationOperators?: boolean
  /** Indent lines that contain only whitespace. Default false. */
  indentBlankLines?: boolean
  /**
   * Individual lint/format rules, by their swift-format name - the same map a
   * `.swift-format` file's `"rules"` object holds, e.g. `{ OrderedImports: false }`.
   * Rules not named here keep their default.
   */
  rules?: Record<string, boolean>
}

/**
 * Supplies the compiled wasm module, however this environment gets hold of it.
 *
 * There are two implementations - one reads the artifact from disk, one fetches
 * it - and each caches the compiled module itself, so this is called once per
 * boot rather than once per format.
 */
export type ArtifactSource = () => Promise<WebAssembly.Module>

/** What `createFormat` returns, and what every entry point exports as `format`. */
export type FormatFunction = (source: string, options?: FormatOptions) => Promise<string>

/**
 * Options for the browser build's `init`, which is the seam for telling the
 * package where its artifact lives. Every field is optional; the defaults
 * resolve `swift_fmt.wasm.br` relative to the module and expand it here.
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
 * The module's `run` export, plus the memory it was instantiated with.
 *
 * `run` takes no arguments and returns a status code: source, configuration and
 * result all cross through the preopened `/work` directory rather than through
 * linear memory, so there is nothing to pass. See the Swift side for what each
 * status means.
 */
export type SwiftFormatModule = {
  /** Formats `/work/input.swift` into `/work/output.swift`, returning a status. */
  run: () => number
  /** The `/work` directory's contents, mutated between calls to hand input over and take output back. */
  workFiles: Map<string, unknown>
  /** Lines the module wrote to stderr during the current call, cleared before each one. */
  diagnostics: string[]
}
