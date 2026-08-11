/**
 * Options accepted by `format`. Each one mirrors a CSharpier configuration key,
 * and every default is the tool's own default rather than one we picked - the
 * package is the tool, so `format(source)` has to mean what `csharpier format
 * <file>` means for a file with no `.csharpierrc` next to it.
 */
export type FormatOptions = {
  /** Column the printer tries to stay inside. CSharpier's `printWidth`, default 100. */
  printWidth?: number
  /** Indent with tabs instead of spaces. CSharpier's `useTabs`, default false. */
  useTabs?: boolean
  /** Spaces per indent level, ignored when `useTabs` is set. CSharpier's `indentSize`, default 4. */
  indentSize?: number
  /**
   * Line ending to print. CSharpier's `endOfLine`, default `auto`, which takes
   * its cue from the first line ending in the input and falls back to `lf`.
   */
  endOfLine?: 'auto' | 'lf' | 'crlf'
}

/**
 * The function the wasm module exports, as `[JSExport]` presents it.
 *
 * Options cross as separate primitives rather than an object because the .NET
 * JavaScript interop marshals `int`, `bool` and `string` natively, while
 * reading typed fields off a JSObject would cost more C# for no gain.
 *
 * The result carries a leading status character - see `format`.
 */
export type FormatFunction = (
  source: string,
  printWidth: number,
  useTabs: boolean,
  indentSize: number,
  endOfLine: string,
) => string

/** The shape of `getAssemblyExports` output that we actually use. */
export type ModuleExports = {
  CSharpFmt: { Format: FormatFunction }
}
