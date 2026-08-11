import { format } from './format'
import type { FormatOptions } from './types'
import { describe, expect, it } from 'bun:test'

describe('format', () => {
  it('formats a class body', async () => {
    const out = await format('class A\n  def initialize(b)\n@b=b\n  end\nend')
    expect(out).toBe('class A\n  def initialize(b)\n    @b = b\n  end\nend\n')
  })

  it('is idempotent', async () => {
    const once = await format('x=[1,2,3].map{|n| n*2}')
    expect(await format(once)).toBe(once)
  })

  // The source is written into the guest filesystem rather than interpolated
  // into Ruby code. If it were embedded in a double-quoted Ruby string, #{...}
  // would be evaluated by the VM - JSON escaping does not escape '#'.
  it('does not evaluate #{} interpolation in the input', async () => {
    const out = await format('puts "hi #{name}"')
    expect(out).toMatch(/#\{name\}/)
  })

  it('does not evaluate a command-substitution attempt', async () => {
    const out = await format('x = "#{`echo pwned`}"')
    expect(out).toMatch(/echo pwned/)
  })

  it('preserves comments', async () => {
    const out = await format('# leading comment\nclass A # trailing\nend')
    expect(out).toMatch(/# leading comment/)
    expect(out).toMatch(/# trailing/)
  })

  it('respects printWidth', async () => {
    const source = 'foo(aaaaaaaaaa, bbbbbbbbbb, cccccccccc, dddddddddd, eeeeeeeeee)'
    expect((await format(source, { printWidth: 100 })).trim()).toBe(source)
    expect((await format(source, { printWidth: 20 })).split('\n').length).toBeGreaterThan(2)
  })

  // printWidth reaches Ruby by string interpolation, and the types only bind
  // TypeScript callers - a JavaScript caller can pass anything at all.
  it('rejects a printWidth that is not a positive integer', async () => {
    const injected = { printWidth: '80; system("echo pwned")' } as unknown as FormatOptions
    expect(format('a=1', injected)).rejects.toThrow(TypeError)
    expect(format('a=1', { printWidth: 0 })).rejects.toThrow(TypeError)
    expect(format('a=1', { printWidth: Number.NaN })).rejects.toThrow(TypeError)
  })

  it('handles UTF-8 without corrupting bytes', async () => {
    const out = await format('x = "héllo wörld 🌍"')
    expect(out).toMatch(/héllo wörld 🌍/)
  })

  it('reuses one VM across calls', async () => {
    const [a, b] = await Promise.all([format('a=1'), format('b=2')])
    expect(a).toBe('a = 1\n')
    expect(b).toBe('b = 2\n')
  })

  it('rejects invalid syntax', async () => {
    expect(format('def broken(')).rejects.toThrow()
  })
})
