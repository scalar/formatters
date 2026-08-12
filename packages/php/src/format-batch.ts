import { bootPhp } from './boot-php'
import { normalizeRules } from './normalize-rules'
import { BATCH_DATA_PATH, BATCH_FIXER_SCRIPT_PATH, CONFIG_DATA_PATH, RESULT_PATH } from './paths'
import type { FormatOptions, FormatResult } from './types'

type BatchItem =
  | { status: 'ok'; source: string }
  | { status: 'parse-error'; message: string; line: number }
  | { status: 'failed'; exit: number; output: string }

/** Formats a group in one PHP CS Fixer invocation, preserving positional failures. */
export const formatBatch = async (sources: readonly string[], options: FormatOptions = {}): Promise<FormatResult[]> => {
  if (sources.length === 0) return []

  const { php } = await bootPhp()
  php.writeFile(
    CONFIG_DATA_PATH,
    JSON.stringify({
      rules: normalizeRules(options.rules ?? '@PSR12'),
      indent: options.indent ?? '    ',
      lineEnding: options.lineEnding ?? '\n',
      riskyAllowed: options.riskyAllowed ?? false,
    }),
  )
  php.writeFile(BATCH_DATA_PATH, JSON.stringify(sources))

  await php.run({ scriptPath: BATCH_FIXER_SCRIPT_PATH })

  const items = JSON.parse(php.readFileAsText(RESULT_PATH)) as BatchItem[]
  return items.map((item) => {
    if (item.status === 'ok') return item.source
    if (item.status === 'parse-error') {
      return new SyntaxError(`PHP parse error on line ${item.line}: ${item.message}`)
    }
    return new Error(`php-cs-fixer failed (exit ${item.exit}): ${item.output.trim() || 'no diagnostics'}`)
  })
}
