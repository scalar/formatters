import { createBootModule } from './boot-module'
import type { FormatOptions, Formatters, ModuleExports, RuntimeSource } from './types'

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
 * Formats one source through the already-booted runtime.
 *
 * Every step here is synchronous, which is the whole reason `formatSync` can
 * exist: the only asynchronous thing this package ever does is get the runtime
 * booted, and by the time this runs that has happened.
 */
const through = (exports: ModuleExports, source: string, options: FormatOptions): string => {
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

/**
 * Builds the package's public functions over one runtime source.
 *
 * The entry points call this: `index.ts` with the source that reads from disk,
 * `index.browser.ts` with the one that fetches. Everything below this line is
 * identical either way, which is the point - the environment difference is
 * confined to how the assets arrive.
 */
export const createFormat = (source: RuntimeSource): Formatters => {
  const { boot, peek } = createBootModule(source)

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
  const format = async (input: string, options: FormatOptions = {}): Promise<string> =>
    through(await boot(), input, options)

  /**
   * Formats C# source without awaiting, for callers that cannot.
   *
   * Same CSharpier, same options, same bytes out as `format` - the only
   * difference is that this one refuses to wait. Booting is asynchronous no
   * matter what (the assemblies have to be fetched or read, and the runtime
   * started), so this throws until that has happened. Call `init` once, then
   * this as often as you like.
   *
   * This exists for callers whose seams are synchronous all the way down - a
   * code generator that formats each file inside the builder that emits it, a
   * template renderer, a plugin hook that has to return a string. Prefer
   * `format` anywhere you can await: it needs no setup call and cannot throw
   * this error.
   */
  const formatSync = (input: string, options: FormatOptions = {}): string => {
    const exports = peek()
    if (!exports) {
      throw new Error(
        'formatSync was called before the runtime finished booting. Await init() once before the first ' +
          'formatSync, or use the async format() instead, which waits on its own.',
      )
    }

    return through(exports, input, options)
  }

  /**
   * Boots the runtime, so that `formatSync` can be called afterwards.
   *
   * Optional for `format`, which boots on demand, and required exactly once
   * before `formatSync`. Awaiting it twice is harmless - the boot is cached, so
   * the second call resolves against the first.
   */
  const init = async (): Promise<void> => {
    await boot()
  }

  return { format, formatSync, init }
}
