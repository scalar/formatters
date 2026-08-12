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

  // Stock syntax_tree 6.3.0 drops the `then` here and hands back source Ruby
  // cannot parse. These three cover the shapes that reach it - an alternative,
  // a hash pattern it unwraps, and one where the endless range is not last -
  // because each one arrives at the trailing `..` by a different route.
  it('keeps then when an alternative pattern ends in an endless range', async () => {
    const out = await format('case s\nin 300.. | 400.. then\n  a\nend\n')
    expect(out).toBe('case s\nin 300.. | 400.. then\n  a\nend\n')
  })

  it('keeps then when unwrapping a hash pattern leaves a trailing endless range', async () => {
    const out = await format('case s\nin { status: 400.. } then\n  a\nend\n')
    expect(out).toBe('case s\nin status: 400.. then\n  a\nend\n')
  })

  it('omits then when the endless range is not the last thing in the pattern', async () => {
    const out = await format('case s\nin { status: 400.., body: String } then\n  a\nend\n')
    expect(out).toBe('case s\nin { status: 400.., body: String }\n  a\nend\n')
  })

  // A string that happens to end in dots is not an endless range. Deciding on
  // the rendered pattern rather than on its node types is what keeps this from
  // growing a stray `then`.
  it('does not add then for a literal that merely ends in dots', async () => {
    const out = await format('case s\nin { m: "ends.." } then\n  a\nend\n')
    expect(out).toBe('case s\nin m: "ends.."\n  a\nend\n')
  })

  // Every case/in shape above is only interesting because the output has to be
  // parseable, so assert that directly on the one that used to break.
  it('returns Ruby that parses for endless range patterns', async () => {
    const out = await format('case s\nin 300.. | 400.. then\n  a\nend\n')
    expect(format(out)).resolves.toBe(out)
  })
})
