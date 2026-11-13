import type { FormatOptions } from './types'

/**
 * The Ruby version RuboCop is told to target.
 *
 * It has to be stated rather than left to RuboCop, because RuboCop works it out
 * from its surroundings - a gemspec's `required_ruby_version`, a `.ruby-version`
 * file, the `TargetRubyVersion` key - and inside the wasm module there are no
 * surroundings, so it would fall back to its floor (2.7) and format for a Ruby
 * nobody is writing. Pinning it also makes the conformance test meaningful: the
 * native RuboCop it compares against reads this same config.
 */
const TARGET_RUBY_VERSION = 3.4

/**
 * The line length when the caller names none.
 *
 * 120 because it is RuboCop's own `Layout/LineLength` default, which makes the
 * no-options output exactly what stock `rubocop --autocorrect --only Layout`
 * writes. The 80 this package used to default to was its old reprinter's, and
 * meant a printer's width; here the number is a cop's limit, and a lower one
 * only means the cop rebreaks more of the line structure the caller chose.
 */
export const DEFAULT_PRINT_WIDTH = 120

/**
 * Reads `printWidth` off the options, checked.
 *
 * Coerced and checked rather than trusted, because the types are advisory to a
 * JavaScript caller and RuboCop would take a fractional or negative `Max` and
 * do something unhelpful with it rather than refuse it.
 */
const printWidthOf = (options: FormatOptions): number => {
  const printWidth = Number(options.printWidth ?? DEFAULT_PRINT_WIDTH)
  if (!Number.isInteger(printWidth) || printWidth < 1) {
    throw new TypeError(`printWidth must be a positive integer, received ${String(options.printWidth)}`)
  }
  return printWidth
}

/**
 * Builds the `.rubocop.yml` the RuboCop pass loads for one set of options.
 *
 * Deliberately tiny. Everything about which cops run and how they behave comes
 * from RuboCop's own `config/default.yml`, so what this produces is what stock
 * RuboCop produces. Only two things are stated:
 *
 * - `TargetRubyVersion`, which RuboCop cannot discover inside the module.
 * - `Layout/LineLength`'s `Max`, from `printWidth`. Only `Max`: the cop's other
 *   settings, `Enabled` among them, keep RuboCop's defaults.
 *
 * `rubocopConfig` is merged over that one level deep, matching how a
 * `.rubocop.yml` is read: a caller naming `Layout/LineLength` replaces this
 * package's whole entry for it rather than having its keys folded in, so the
 * caller's entry wins over `printWidth`. `printWidth` is still checked in that
 * case, so that a bad value fails the same way whatever else is passed.
 *
 * Emitted as JSON, which is valid YAML and which RuboCop's own loader reads
 * happily. That is not a shortcut: it is what makes an arbitrary caller-supplied
 * object safe to serialise, because JSON escaping is exact where hand-rolled
 * YAML quoting is a guess.
 */
export const buildRuboCopConfig = (options: FormatOptions = {}): string => {
  const base: Record<string, unknown> = {
    AllCops: { TargetRubyVersion: TARGET_RUBY_VERSION },
    'Layout/LineLength': { Max: printWidthOf(options) },
  }

  return `${JSON.stringify({ ...base, ...options.rubocopConfig }, null, 2)}\n`
}
