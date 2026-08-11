/**
 * Options accepted by `format`.
 *
 * Every default is ktfmt's own rather than one we picked - the package *is*
 * ktfmt, so `format(source)` has to mean `ktfmt <file>`. That includes the
 * style: ktfmt's help says "If none of the style options are passed, Meta's
 * style is used."
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
 * The function KtFmt.format parks on the module's exports.
 *
 * Both arguments are strings because that is what survives the boundary
 * cheaply: the second is an encoded option spec rather than an object, since
 * reading typed fields out of a JSObject costs more Java code than splitting
 * seven values. The result carries a leading status character - see `format`.
 */
export type FormatFunction = (source: string, options: string) => string
