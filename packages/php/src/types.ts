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
 * Options accepted by the batch forms of `format` and `formatSync`.
 *
 * `concurrency` is the one option in this package that is not a PHP CS Fixer
 * `Config` setting, which is why it lives here rather than on `FormatOptions`:
 * it changes how fast a batch formats, never what it formats to.
 */
export type BatchOptions = FormatOptions & {
  /**
   * How many PHP instances to spread the batch across. Each one is a separate
   * process costing roughly 220MB, so this trades memory for wall-clock time.
   *
   * Left alone it is chosen from the batch size, the CPUs this process may use
   * and the memory it may spend - cgroup limits included, so a container gets
   * its own budget rather than the host's - and capped at four. Set it to `1` to
   * keep everything in the calling process.
   */
  concurrency?: number
}

/** A positional batch result: formatted source, or that source's failure. */
export type FormatResult = string | Error

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
