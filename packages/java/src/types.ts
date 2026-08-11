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
