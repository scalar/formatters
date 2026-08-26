import type { BenchResult } from './types'

/** Column headings, in the order the table prints them. */
const columns = ['package', 'boot', 'first', 'median', 'mean', 'p95', 'KB/s', 'files'] as const

/** One result as the strings that go in its row. */
const cellsFor = (result: BenchResult): string[] => [
  result.name,
  `${result.bootMs.toFixed(0)}ms`,
  `${result.firstFormatMs.toFixed(1)}ms`,
  `${result.medianMs.toFixed(2)}ms`,
  `${result.meanMs.toFixed(2)}ms`,
  `${result.p95Ms.toFixed(2)}ms`,
  result.kbPerSecond.toFixed(0),
  String(result.files),
]

/**
 * Renders the results as a fixed-width table.
 *
 * Plain text rather than a chart, because the thing this is read for is a diff
 * between two revisions and a terminal diff of aligned columns is the clearest
 * form that has.
 */
export const renderTable = (results: BenchResult[]): string => {
  const rows = [columns as unknown as string[], ...results.map(cellsFor)]
  const widths = columns.map((_, index) => Math.max(...rows.map((row) => (row[index] ?? '').length)))

  const line = (row: string[]): string =>
    row
      .map((cell, index) => (index === 0 ? cell.padEnd(widths[index] ?? 0) : cell.padStart(widths[index] ?? 0)))
      .join('  ')

  const [header, ...body] = rows.map(line)

  return [header, widths.map((width) => '-'.repeat(width)).join('  '), ...body].join('\n')
}
