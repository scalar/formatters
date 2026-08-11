import { format } from './format'
import type { FormatOptions } from './types'
import { describe, expect, it } from 'bun:test'

describe('format', () => {
  it('formats a class body to PSR-12', async () => {
    const out = await format('<?php\nclass A{\npublic function b(){return 1;}\n}')
    expect(out).toBe('<?php\n\nclass A\n{\n    public function b()\n    {\n        return 1;\n    }\n}\n')
  })

  it('is idempotent', async () => {
    const once = await format('<?php\nclass A{\nfunction b(){return 1;}\n}')
    expect(await format(once)).toBe(once)
  })

  it('preserves comments', async () => {
    const out = await format('<?php\n// leading comment\nclass A\n{\n} // trailing')
    expect(out).toMatch(/\/\/ leading comment/)
    expect(out).toMatch(/\/\/ trailing/)
  })

  it('respects indent', async () => {
    const out = await format('<?php\nclass A{\nfunction b(){return 1;}\n}', { indent: '  ' })
    expect(out).toMatch(/\n {2}public function b\(\)/)
  })

  it('respects lineEnding', async () => {
    const out = await format('<?php\nclass A{\n}', { lineEnding: '\r\n' })
    expect(out).toContain('\r\n')
  })

  it('accepts rules as a comma-separated string', async () => {
    const out = await format('<?php\n$x = array(1,2);', { rules: '@PSR12,array_syntax' })
    // Short syntax, but the spacing is untouched: @PSR12 does not include
    // whitespace_after_comma_in_array, and this package adds no rules of its own.
    expect(out).toContain('[1,2]')
  })

  it('accepts rules as an object', async () => {
    const out = await format('<?php\nclass A{\n}', { rules: { '@PSR12': true } })
    expect(out).toBe('<?php\n\nclass A\n{\n}\n')
  })

  // The tool refuses a risky rule unless the config opts in. Surfacing that as
  // an error rather than a silent skip is the point - a rule that quietly did
  // not run is the failure mode this package exists to avoid.
  it('rejects a risky rule unless riskyAllowed is set', async () => {
    expect(format('<?php\n$x = 1;', { rules: 'declare_strict_types' })).rejects.toThrow(/risky|riskyAllowed/i)
  })

  it('applies a risky rule when riskyAllowed is set', async () => {
    const out = await format('<?php\n$x = 1;', {
      rules: 'declare_strict_types',
      riskyAllowed: true,
    })
    expect(out).toContain('declare(strict_types=1)')
  })

  it('throws on source PHP cannot parse', async () => {
    expect(format('<?php class { function ( }')).rejects.toThrow(SyntaxError)
  })

  it('throws on an unknown rule', async () => {
    expect(format('<?php\n$x = 1;', { rules: 'no_such_fixer' })).rejects.toThrow(/unknown fixer/i)
  })

  // Inline HTML outside PHP tags is valid input, not a parse error, and the
  // fixer leaves it alone.
  it('passes through a file with no PHP in it', async () => {
    const out = await format('just some text\n')
    expect(out).toBe('just some text\n')
  })

  // Options reach PHP as JSON and are read back with json_decode, never
  // interpolated into PHP source. The types only bind TypeScript callers - a
  // JavaScript caller can pass anything at all - so a rule name carrying PHP
  // syntax must stay inert data.
  it('does not execute a rule name that contains PHP source', async () => {
    const injected = { rules: "'); system('echo pwned'); //" } as unknown as FormatOptions
    expect(format('<?php\n$x = 1;', injected)).rejects.toThrow(/unknown fixer/i)
  })

  it('does not execute PHP in the source being formatted', async () => {
    const out = await format('<?php\n$cmd = `echo pwned`;\n')
    expect(out).toContain('echo pwned')
  })
})
