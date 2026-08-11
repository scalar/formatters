import { normalizeRules } from './normalize-rules'
import { describe, expect, it } from 'bun:test'

describe('normalize-rules', () => {
  it('turns a single rule set name into an enabled entry', () => {
    expect(normalizeRules('@PSR12')).toEqual({ '@PSR12': true })
  })

  it('splits a comma-separated list', () => {
    expect(normalizeRules('@PSR12,no_unused_imports')).toEqual({
      '@PSR12': true,
      no_unused_imports: true,
    })
  })

  it('ignores surrounding whitespace', () => {
    expect(normalizeRules(' @PSR12 , no_unused_imports ')).toEqual({
      '@PSR12': true,
      no_unused_imports: true,
    })
  })

  // The `-name` form is how the command line disables one rule out of a set.
  it('reads a leading dash as disabling the rule', () => {
    expect(normalizeRules('@PSR12,-blank_line_after_namespace')).toEqual({
      '@PSR12': true,
      blank_line_after_namespace: false,
    })
  })

  it('passes an object through unchanged', () => {
    const rules = { '@PSR12': true, binary_operator_spaces: { default: 'align' } }
    expect(normalizeRules(rules)).toBe(rules)
  })

  it('rejects a string naming no rules', () => {
    expect(() => normalizeRules('  ,  ')).toThrow(TypeError)
  })
})
