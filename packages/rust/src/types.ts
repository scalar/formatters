/**
 * Options accepted by `format`.
 *
 * Every field here is a real rustfmt configuration key, spelled the way a
 * `rustfmt.toml` spells it, because that is what these become: they are handed
 * to rustfmt's own `Config::override_value`, the same code path as
 * `rustfmt --config key=value`. Anything left out keeps rustfmt's default
 * rather than one we picked - there is no second copy of the defaults on this
 * side to fall out of step.
 *
 * This is the stable, widely useful part of rustfmt's configuration, not all of
 * it. `config` is the escape hatch for the rest, including the nightly-only
 * options.
 */
export type FormatOptions = {
  /** Maximum width of each line. rustfmt's default is 100. */
  maxWidth?: number
  /** Number of spaces per tab. Default 4. */
  tabSpaces?: number
  /** Indent with hard tabs rather than spaces. Default false. */
  hardTabs?: boolean
  /**
   * The style edition, which selects the formatting rules as a set - see
   * RFC 3338. Default "2015". This is the option most likely to change output
   * wholesale, because it decides what every other default is.
   */
  styleEdition?: '2015' | '2018' | '2021' | '2024'
  /** The edition of the source being parsed. Default "2015". */
  edition?: '2015' | '2018' | '2021' | '2024'
  /** Line ending style. Default "Auto". */
  newlineStyle?: 'Auto' | 'Windows' | 'Unix' | 'Native'
  /** Whether to reorder and group `use` declarations. Default true. */
  reorderImports?: boolean
  /** Whether to reorder `mod` declarations. Default true. */
  reorderModules?: boolean
  /** Remove nested parens. Default true. */
  removeNestedParens?: boolean
  /** Merge or split imports. Default "Preserve". */
  importsGranularity?: 'Preserve' | 'Crate' | 'Module' | 'Item' | 'One'
  /** Where to put the `where` clause. Default "Default". */
  whereSingleLine?: boolean
  /** Convert `#[doc]` attributes to `///` doc comments. Default false. */
  normalizeDocAttributes?: boolean
  /** Break comments to fit within `maxWidth`. Default false (nightly-only in rustfmt). */
  wrapComments?: boolean
  /** Format code snippets inside doc comments. Default false (nightly-only in rustfmt). */
  formatCodeInDocComments?: boolean
  /** Format string literals that exceed the width. Default false (nightly-only in rustfmt). */
  formatStrings?: boolean
  /**
   * Any rustfmt configuration key, by its own snake_case name, for options this
   * type does not name - `{ 'fn_call_width': 80 }`. Values are stringified the
   * way rustfmt's `--config` expects them. Keys here win over the typed fields
   * above, so this is also the way to override one.
   */
  config?: Record<string, string | number | boolean>
}

/**
 * The module's `run` export, plus the handles a format needs around it.
 *
 * `run` takes no arguments and returns a status code: source, configuration and
 * result all cross through the preopened `/work` directory rather than through
 * linear memory, so there is nothing to pass. See
 * build/rust_fmt/crates/rust_fmt/src/lib.rs for what each status means.
 */
export type RustFormatModule = {
  /** Formats `/work/input.rs` into `/work/output.rs`, returning a status. */
  run: () => number
  /** The `/work` directory's contents, mutated between calls to hand input over and take output back. */
  workFiles: Map<string, unknown>
  /** Lines the module wrote to stderr during the current call, cleared before each one. */
  diagnostics: string[]
}
