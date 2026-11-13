import type { FormatOptions, Formatters, KotlinFormatterBoot } from './types'

/**
 * Builds the package's public functions over one formatter.
 *
 * The entry points call this: `index.ts` with the module read from disk,
 * `index.browser.ts` with the one fetched over HTTP. Everything below this line
 * is identical either way, which is the point - the environment difference is
 * confined to how the bytes arrive.
 */
export const createFormat = (formatter: KotlinFormatterBoot): Formatters => {
  /**
   * Formats Kotlin source as ktfmt does, running ktrs compiled to WebAssembly.
   *
   * The first call decompresses, compiles and instantiates the module; later
   * calls reuse it.
   *
   * Throws on source ktfmt cannot parse, with ktfmt's diagnostic.
   */
  const format = async (source: string, options: FormatOptions = {}): Promise<string> =>
    (await formatter.boot()).format(source, options)

  /**
   * Formats Kotlin source without awaiting, for callers that cannot.
   *
   * Same formatter, same options, same bytes out as `format` - under Node they
   * run the same code, because there booting is synchronous too. In a browser
   * it throws until `init` has resolved, because the artifact has to be fetched
   * and a fetch cannot be waited on synchronously.
   *
   * This exists for callers whose seams are synchronous all the way down - a
   * code generator that formats each file inside the builder that emits it, a
   * template renderer, a plugin hook that has to return a string.
   */
  const formatSync = (source: string, options: FormatOptions = {}): string => {
    const booted = formatter.bootSync()

    if (!booted) {
      throw new Error(
        'formatSync was called before the artifact was fetched. In a browser, await init() once before the ' +
          'first formatSync, or use the async format(), which waits on its own.',
      )
    }

    return booted.format(source, options)
  }

  /**
   * Boots the formatter ahead of the first format.
   *
   * Optional under Node, where nothing needs it; there it only moves the cold
   * start. Required in a browser before the first `formatSync`.
   */
  const init = async (): Promise<void> => {
    await formatter.boot()
  }

  return { format, formatSync, init }
}
