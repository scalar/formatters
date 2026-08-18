import { createBootModule } from './boot-module'
import type { FormatFunction, FormatOptions, Formatters, ModuleLoader } from './types'

/** Status character the Kotlin side prefixes a failure with. */
const ERROR = 'E'

/** A field the Kotlin side reads as "whatever the chosen style says". */
const INHERIT = '-'

const number = (value: number | undefined): string => (value === undefined ? INHERIT : String(value))
const flag = (value: boolean | undefined): string => (value === undefined ? INHERIT : value ? '1' : '0')

/**
 * Encodes options as the pipe-delimited spec KtFmt parses. Anything left
 * undefined stays `-`, so the style's own value applies and no default is
 * restated on this side.
 */
const encodeOptions = (options: FormatOptions): string =>
  [
    options.style ?? 'meta',
    number(options.maxWidth),
    number(options.blockIndent),
    number(options.continuationIndent),
    options.trailingCommas ?? INHERIT,
    flag(options.removeUnusedImports),
    flag(options.preserveLambdaBreaks),
  ].join('|')

/**
 * Formats one source through the already-booted export.
 *
 * Every step here is synchronous, which is the whole reason `formatSync` can
 * exist: the only asynchronous thing this package ever does is get the wasm
 * loaded, and by the time this runs that has happened.
 */
const through = (formatSource: FormatFunction, source: string, options: FormatOptions): string => {
  // Results carry a one-character status because a Java exception crossing the
  // boundary arrives as a Java proxy object rather than an Error: it has no
  // message property, and reading its properties throws. Failures are encoded
  // instead, so a syntax error can be reported as the diagnostic ktfmt actually
  // produced.
  const result = formatSource(String(source), encodeOptions(options))
  if (result.startsWith(ERROR)) throw new Error(result.slice(1))
  return result.slice(1)
}

/**
 * Builds the package's public functions over one module loader.
 *
 * The entry points call this: `index.ts` with the loader that reads the wasm
 * from disk, `index.browser.ts` with the one that fetches it. Everything below
 * this line is identical either way, which is the point - the environment
 * difference is confined to how the bytes arrive.
 */
export const createFormat = (loadModule: ModuleLoader): Formatters => {
  const { boot, peek } = createBootModule(loadModule)

  /**
   * Formats Kotlin source with ktfmt compiled to WebAssembly.
   *
   * The first call decompresses and boots the module; later calls reuse it and
   * take milliseconds.
   *
   * Throws on source ktfmt cannot parse, with ktfmt's own diagnostic.
   */
  const format = async (source: string, options: FormatOptions = {}): Promise<string> => {
    const formatSource = await boot()
    return through(formatSource, source, options)
  }

  /**
   * Formats Kotlin source without awaiting, for callers that cannot.
   *
   * Same ktfmt, same options, same bytes out as `format` - the only difference
   * is that this one refuses to wait. Booting is asynchronous no matter what
   * (the wasm has to be fetched or read, and compiled), so this throws until
   * that has happened. Call `init` once, then this as often as you like.
   *
   * This exists for callers whose seams are synchronous all the way down - a
   * code generator that formats each file inside the builder that emits it, a
   * template renderer, a plugin hook that has to return a string. Prefer
   * `format` anywhere you can await: it needs no setup call and cannot throw
   * this error.
   */
  const formatSync = (source: string, options: FormatOptions = {}): string => {
    const formatSource = peek()
    if (!formatSource) {
      throw new Error(
        'formatSync was called before the module finished booting. Await init() once before the first ' +
          'formatSync, or use the async format() instead, which waits on its own.',
      )
    }

    return through(formatSource, source, options)
  }

  /**
   * Boots the module, so that `formatSync` can be called afterwards.
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
