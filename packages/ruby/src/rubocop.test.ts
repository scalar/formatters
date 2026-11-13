import { DEFAULT_PRINT_WIDTH, buildRuboCopConfig } from './rubocop'
import type { FormatOptions } from './types'
import { describe, expect, it } from 'bun:test'

/** The config as RuboCop will read it - the text is JSON, which is valid YAML. */
const parsed = (options?: FormatOptions): Record<string, Record<string, unknown>> =>
  JSON.parse(buildRuboCopConfig(options))

describe('rubocop', () => {
  // 120 is RuboCop's own default, which is what makes the no-options output
  // identical to stock `rubocop --autocorrect --only Layout`.
  it('defaults Layout/LineLength to RuboCop own 120', () => {
    expect(DEFAULT_PRINT_WIDTH).toBe(120)
    expect(parsed()['Layout/LineLength']).toEqual({ Max: 120 })
  })

  it('maps printWidth to Layout/LineLength Max', () => {
    expect(parsed({ printWidth: 80 })['Layout/LineLength']).toEqual({ Max: 80 })
  })

  // Only `Max`, so the cop stays enabled and its other settings - AllowURI,
  // AllowedPatterns and the rest - keep RuboCop's defaults.
  it('states only Max, leaving the cop enabled by RuboCop default', () => {
    expect(Object.keys(parsed({ printWidth: 100 })['Layout/LineLength'] ?? {})).toEqual(['Max'])
  })

  // One level deep, the way a .rubocop.yml is read: the caller's entry for the
  // cop replaces this package's, so printWidth has no say once it is named.
  it('lets a caller Layout/LineLength entry replace the printWidth one', () => {
    const config = parsed({ printWidth: 80, rubocopConfig: { 'Layout/LineLength': { Enabled: false } } })

    expect(config['Layout/LineLength']).toEqual({ Enabled: false })
  })

  it('keeps printWidth when rubocopConfig names other cops', () => {
    const config = parsed({ printWidth: 90, rubocopConfig: { 'Layout/IndentationWidth': { Width: 4 } } })

    expect(config['Layout/LineLength']).toEqual({ Max: 90 })
    expect(config['Layout/IndentationWidth']).toEqual({ Width: 4 })
  })

  it('pins the target Ruby version', () => {
    expect(parsed()['AllCops']).toEqual({ TargetRubyVersion: 3.4 })
  })

  // The types bind only TypeScript callers, and RuboCop would take a fractional
  // or negative Max without complaint.
  it('rejects a printWidth that is not a positive integer', () => {
    for (const printWidth of [0, -1, 1.5, Number.NaN, '80; x'] as unknown as number[]) {
      expect(() => buildRuboCopConfig({ printWidth })).toThrow(TypeError)
    }
  })

  // Checked even when it would be overridden, so a bad value fails the same way
  // whatever else is passed.
  it('rejects a bad printWidth even when rubocopConfig overrides the cop', () => {
    expect(() => buildRuboCopConfig({ printWidth: 0, rubocopConfig: { 'Layout/LineLength': { Max: 100 } } })).toThrow(
      TypeError,
    )
  })

  // JSON escaping is what makes an arbitrary caller value safe to hand over.
  it('serialises caller strings exactly', () => {
    const description = 'quote " backslash \\ newline \n #{interpolation}'
    const config = parsed({ rubocopConfig: { 'Layout/IndentationWidth': { Description: description } } })

    expect(config['Layout/IndentationWidth']).toEqual({ Description: description })
  })
})
