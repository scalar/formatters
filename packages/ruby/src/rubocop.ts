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
 * The configuration this package gives RuboCop, before anything the caller adds.
 *
 * Deliberately tiny. Everything about which cops run and how they behave comes
 * from RuboCop's own `config/default.yml`, so what this produces is what stock
 * RuboCop produces. Only two things are stated, and both are here because the
 * default would be wrong rather than because we prefer something else:
 *
 * - `TargetRubyVersion`, which RuboCop cannot discover inside the module.
 * - `Layout/LineLength`, which is **off**, because line width belongs to
 *   syntax_tree. syntax_tree reprints, so it is the tool that can actually
 *   honour `printWidth`; RuboCop only rebreaks what it is handed. With the cop
 *   on, the two disagreed whenever `printWidth` went above RuboCop's `Max: 120`
 *   default - `{ printWidth: 200 }` came back rewrapped at 124, which is
 *   neither width. Turning it off costs nothing measurable: over 397 files of
 *   real Ruby at the default width it changes none of them, and the 9 files
 *   with a line over 120 have one either way, because the cop's autocorrect
 *   could not fix them regardless.
 */
const BASE_CONFIG: Record<string, unknown> = {
  AllCops: { TargetRubyVersion: TARGET_RUBY_VERSION },
  'Layout/LineLength': { Enabled: false },
}

/**
 * Builds the `.rubocop.yml` the RuboCop pass loads, with a caller's overrides
 * merged over {@link BASE_CONFIG}.
 *
 * Emitted as JSON, which is valid YAML and which RuboCop's own loader reads
 * happily. That is not a shortcut: it is what makes an arbitrary caller-supplied
 * object safe to serialise, because JSON escaping is exact where hand-rolled
 * YAML quoting is a guess.
 *
 * Merging is one level deep, matching how a `.rubocop.yml` is read: a caller
 * naming `Layout/LineLength` replaces that whole entry rather than having its
 * keys folded into ours, which is what makes the cop above re-enablable.
 */
export const buildRuboCopConfig = (overrides: Record<string, unknown> = {}): string =>
  `${JSON.stringify({ ...BASE_CONFIG, ...overrides }, null, 2)}\n`
