import { bootModule } from './boot-module'
import type { FormatOptions } from './types'

/** Status characters the Java side prefixes its result with. */
const ERROR = 'E'

/** Encodes options as the "style|sort|remove|reflow" spec JavaFmt parses. */
const encodeOptions = (options: FormatOptions): string =>
  [
    options.style === 'aosp' ? 'aosp' : 'google',
    options.sortImports === false ? '0' : '1',
    options.removeUnusedImports === false ? '0' : '1',
    options.reflowLongStrings === false ? '0' : '1',
  ].join('|')

/**
 * Formats Java source with google-java-format compiled to WebAssembly.
 *
 * This runs the CLI's pipeline, not just its formatter: format, remove unused
 * imports, sort imports, reflow long strings. Every step is on by default
 * because every one of them is on by default in the tool, and `Formatter`
 * alone would leave imports untouched and text blocks unreflowed.
 *
 * The first call decompresses and boots the module (~0.7s); later calls reuse
 * it and take milliseconds.
 */
export const format = async (source: string, options: FormatOptions = {}): Promise<string> => {
  const formatSource = await bootModule()

  // Results carry a one-character status because a Java exception crossing the
  // boundary arrives as a Java proxy object rather than an Error: it has no
  // message property, and reading its properties throws. Failures are encoded
  // instead, so a syntax error can be reported as the diagnostic
  // google-java-format actually produced.
  const result = formatSource(String(source), encodeOptions(options))
  if (result.startsWith(ERROR)) throw new Error(result.slice(1))
  return result.slice(1)
}
