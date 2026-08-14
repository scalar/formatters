import { bootPhp } from './boot-php'
import { formatPool } from './format-pool'
import { normalizeRules } from './normalize-rules'
import { CONFIG_DATA_PATH, FIXER_SCRIPT_PATH, INPUT_PATH, RESULT_PATH } from './paths'
import type { BatchOptions, FormatOptions, FormatResult } from './types'

/**
 * PHP CS Fixer has no default rule set of its own - `--rules` falls back to
 * `@PSR12` only when it finds no configuration file, and there is no
 * configuration file to find here. Same fallback, chosen for the same reason.
 */
const DEFAULT_RULES = '@PSR12'

/** `Config`'s own defaults, restated because we always construct a `Config`. */
const DEFAULT_INDENT = '    '
const DEFAULT_LINE_ENDING = '\n'

/** What the driver script leaves in `RESULT_PATH`. */
type FixerResult =
  | { status: 'ok' }
  | { status: 'parse-error'; message: string; line: number }
  | { status: 'failed'; exit: number; output: string }

const formatOne = async (source: string, options: FormatOptions = {}): Promise<string> => {
  const { php } = await bootPhp()

  // Options reach PHP as JSON and are read back with json_decode - never
  // interpolated into PHP source. TypeScript stops nothing here: the types bind
  // TypeScript callers only, and a JavaScript caller can pass any shape at all.
  php.writeFile(
    CONFIG_DATA_PATH,
    JSON.stringify({
      rules: normalizeRules(options.rules ?? DEFAULT_RULES),
      indent: options.indent ?? DEFAULT_INDENT,
      lineEnding: options.lineEnding ?? DEFAULT_LINE_ENDING,
      riskyAllowed: options.riskyAllowed ?? false,
    }),
  )

  // The fixer rewrites its input in place, so the file is both argument and
  // return value.
  php.writeFile(INPUT_PATH, source)

  await php.run({ scriptPath: FIXER_SCRIPT_PATH })

  const result = JSON.parse(php.readFileAsText(RESULT_PATH)) as FixerResult

  if (result.status === 'parse-error') {
    throw new SyntaxError(`PHP parse error on line ${result.line}: ${result.message}`)
  }

  if (result.status === 'failed') {
    // The fixer's own rendered message - an unknown rule name, a risky rule
    // without riskyAllowed - is far more useful than the exit code, so lead
    // with it and keep the code for the cases that produce no output.
    throw new Error(`php-cs-fixer failed (exit ${result.exit}): ${result.output.trim() || 'no diagnostics'}`)
  }

  return php.readFileAsText(INPUT_PATH)
}

/**
 * Formats PHP source with PHP CS Fixer running on PHP compiled to WebAssembly.
 * The first call boots PHP and installs the fixer (~500ms); later calls reuse
 * the instance and take about 290ms.
 *
 * Rules default to `@PSR12`. Note that this formats a *string*: the fixer's
 * configuration-file discovery needs a real project on disk and there is none
 * here, so a project's `.php-cs-fixer.php` has to be read and passed in as
 * options (see the README).
 *
 * Pass an array to format a group, and prefer that over a call per file whenever
 * you have the files together. The fixer's autoload and application setup then
 * run once for the whole group, and the group is spread across several PHP
 * instances - which is the difference between 200 generated files taking 22s and
 * taking 7s. Results come back in input order, with a failed file as an `Error`
 * in its own position rather than a throw that loses the rest.
 */
export function format(source: string, options?: FormatOptions): Promise<string>
export function format(sources: readonly string[], options?: BatchOptions): Promise<FormatResult[]>
export function format(
  source: string | readonly string[],
  options: BatchOptions = {},
): Promise<string | FormatResult[]> {
  return typeof source === 'string' ? formatOne(source, options) : formatPool(source, options)
}
