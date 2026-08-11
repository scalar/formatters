import type { PHP } from '@php-wasm/universal'

/**
 * A rule set (`@PSR12`), a single fixer (`no_unused_imports`), or a fixer with
 * its own configuration - the same shapes `Config::setRules()` accepts.
 */
export type Rules = string | Record<string, boolean | Record<string, unknown>>

/**
 * Options accepted by `format`. Every one of these is a PHP CS Fixer `Config`
 * setting, so the defaults are the tool's own defaults rather than ones we
 * picked - with the single exception of `rules`, which has no default in the
 * tool because a project always supplies one.
 */
export type FormatOptions = {
  /**
   * Rules to apply. A string is read as a comma-separated list of rule and rule
   * set names, exactly as `--rules` reads it on the command line; an object is
   * passed through to `Config::setRules()` unchanged.
   *
   * Defaults to `@PSR12`. PHP CS Fixer itself has no default: `--rules` falls
   * back to `@PSR12` only when no configuration file is found, and this package
   * cannot look for one (see the README).
   */
  rules?: Rules
  /** Indentation string. The tool's default is four spaces. */
  indent?: string
  /** Line ending. The tool's default is `\n`. */
  lineEnding?: '\n' | '\r\n'
  /**
   * Whether rules marked risky may run. Risky rules can change program
   * behaviour, which is why the tool makes you opt in; defaults to `false`, and
   * a risky rule requested without this is an error rather than a silent skip.
   */
  riskyAllowed?: boolean
}

/**
 * A booted PHP runtime with the fixer artifact and its driver scripts already
 * written into the guest filesystem.
 *
 * Only the `PHP` handle travels: unlike the Ruby package there is nothing to
 * watch and nothing to recycle, because the embed SAPI is reusable across calls
 * and formatting does not leak (see `boot-php.ts`).
 */
export type PhpFormatterRuntime = {
  /** PHP (wasm) with php-cs-fixer.phar and the driver scripts installed. */
  php: PHP
}
