import { createBootModule } from './boot-module'
import type { FormatOptions, Formatter, ModuleLoader } from './types'

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
 * Builds `format` over one module loader.
 *
 * The entry points call this: `index.ts` with the loader that reads the wasm
 * from disk, `index.browser.ts` with the one that fetches it. Everything below
 * this line is identical either way, which is the point - the environment
 * difference is confined to how the bytes arrive.
 */
export const createFormat = (loadModule: ModuleLoader): Formatter => {
  const bootModule = createBootModule(loadModule)

  /**
   * Formats Kotlin source with ktfmt compiled to WebAssembly.
   *
   * The first call decompresses and boots the module; later calls reuse it and
   * take milliseconds.
   *
   * Throws on source ktfmt cannot parse, with ktfmt's own diagnostic.
   */
  return async (source: string, options: FormatOptions = {}): Promise<string> => {
    const formatSource = await bootModule()

    // Results carry a one-character status because a Java exception crossing the
    // boundary arrives as a Java proxy object rather than an Error: it has no
    // message property, and reading its properties throws. Failures are encoded
    // instead, so a syntax error can be reported as the diagnostic ktfmt actually
    // produced.
    const result = formatSource(String(source), encodeOptions(options))
    if (result.startsWith(ERROR)) throw new Error(result.slice(1))
    return result.slice(1)
  }
}
