import { createBootModule } from './boot-module'
import type { FormatOptions, Formatter, RuntimeSource } from './types'

/** Status character the C# side prefixes a failed format with. */
const ERROR = 'E'

/**
 * A byte-order mark, which CSharpier's library drops and its CLI keeps.
 *
 * `CSharpFormatter.Format` takes a string, so by the time source reaches it the
 * encoding is gone and a leading mark is just a character the parser discards.
 * The CLI does not lose it: it detects the file's encoding up front and writes
 * the result back in the same one, mark included. Since this package claims to
 * be the tool, `format` re-attaches it.
 */
const BOM = '﻿'

/**
 * Builds `format` over one runtime source.
 *
 * The entry points call this: `index.ts` with the source that reads from disk,
 * `index.browser.ts` with the one that fetches. Everything below this line is
 * identical either way, which is the point - the environment difference is
 * confined to how the assets arrive.
 */
export const createFormat = (source: RuntimeSource): Formatter => {
  const bootModule = createBootModule(source)

  /**
   * Formats C# source with CSharpier compiled to WebAssembly.
   *
   * This is CSharpier's own formatting path, not an approximation of it: for a
   * `.cs` file the CLI dispatches straight to the same `CSharpFormatter.Format`
   * that runs inside the module here. What the CLI adds around it - finding
   * files, resolving `.csharpierrc` and `.editorconfig`, honouring ignore files,
   * detecting encodings - is a caller's job, because none of it exists inside a
   * module with no filesystem.
   *
   * The first call decompresses the archive and boots the runtime (~1s, most of
   * it warming Roslyn's parser); later calls reuse it and take milliseconds.
   *
   * Throws on source that does not parse, with the diagnostics CSharpier itself
   * produced.
   */
  return async (source: string, options: FormatOptions = {}): Promise<string> => {
    const exports = await bootModule()

    const text = String(source)
    const result = exports.CSharpFmt.Format(
      text,
      options.printWidth ?? 100,
      options.useTabs ?? false,
      options.indentSize ?? 4,
      options.endOfLine ?? 'auto',
    )

    if (result.startsWith(ERROR)) throw new Error(result.slice(1))

    const formatted = result.slice(1)
    return text.startsWith(BOM) && !formatted.startsWith(BOM) ? BOM + formatted : formatted
  }
}
