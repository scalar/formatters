import { buildRuboCopConfig } from './rubocop'
import type { FormatOptions, Formatters, RbcopBoot } from './types'

/**
 * Turns the options into the config text the pass loads, refusing the one
 * option that no longer means anything.
 *
 * `rubocop: false` used to mean "reprint only, skip the RuboCop pass". There is
 * no reprinting pass any more, so honouring it would mean handing the input
 * back unformatted and calling it formatted. It is not in the type, but a
 * JavaScript caller, or one upgrading, can still pass it, and a loud error is
 * the only answer that cannot be mistaken for success. `rubocop: true` is the
 * only behaviour there is, so it is let through.
 */
const configFor = (options: FormatOptions): string => {
  if ((options as { rubocop?: unknown }).rubocop === false) {
    throw new TypeError(
      'the `rubocop` option has been removed. The package is the RuboCop Layout pass and nothing else, so ' +
        '`rubocop: false` would leave nothing to run. Drop the option; to skip formatting a file, do not call format.',
    )
  }

  return buildRuboCopConfig(options)
}

/**
 * Builds the package's public functions over one rbcop.
 *
 * The entry points call this: `index.ts` with the module read from disk,
 * `index.browser.ts` with the one fetched over HTTP. Everything below this line
 * is identical either way, which is the point - the environment difference is
 * confined to how the bytes arrive.
 */
export const createFormat = (rbcop: RbcopBoot): Formatters => {
  /**
   * Formats Ruby source with `rubocop --autocorrect --only Layout`, running as
   * rbcop compiled to WebAssembly.
   *
   * The first call decompresses, compiles and instantiates the module; later
   * calls reuse it and take a few milliseconds.
   */
  const format = async (source: string, options: FormatOptions = {}): Promise<string> => {
    // Options are checked before booting, so a bad one fails without paying for
    // the module.
    const config = configFor(options)
    return (await rbcop.boot()).correct(source, config)
  }

  /**
   * Formats Ruby source without awaiting, for callers that cannot.
   *
   * Same pass, same options, same bytes out as `format` - under Node they run
   * the same code, because there booting is synchronous too. In a browser it
   * throws until `init` has resolved, because the artifact has to be fetched
   * and a fetch cannot be waited on synchronously; and on a browser main thread
   * it throws again after the RuboCop pass has crashed, because the main thread
   * refuses to instantiate a module this size synchronously. `await init()`
   * clears either.
   */
  const formatSync = (source: string, options: FormatOptions = {}): string => {
    const config = configFor(options)
    const corrector = rbcop.bootSync()

    if (!corrector) {
      throw new Error(
        'formatSync could not instantiate the formatter without awaiting. In a browser, await init() once ' +
          'before the first formatSync - and again after a crash on the main thread - or use the async ' +
          'format(), which waits on its own.',
      )
    }

    return corrector.correct(source, config)
  }

  /**
   * Boots rbcop ahead of the first format.
   *
   * Optional under Node, where nothing needs it; there it only moves the cold
   * start. Required in a browser before the first `formatSync`.
   */
  const init = async (): Promise<void> => {
    await rbcop.boot()
  }

  return { format, formatSync, init }
}
