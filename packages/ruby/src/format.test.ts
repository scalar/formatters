// Imports the wired entry point rather than `createFormat`, because `format`
// bound to the on-disk artifact is what a Node consumer actually gets.
import { format, formatSync, init } from './index'
import type { FormatOptions } from './types'
import { describe, expect, it } from 'bun:test'

/**
 * Generous, because the first call into a VM that asks for RuboCop has to
 * require it, and 698 cop files take about eight seconds to load under wasm.
 * Only the first test to ask pays it, but which test that is depends on run
 * order, so they all carry it.
 */
const RUBOCOP_TIMEOUT_MS = 60_000

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

  // Everything below turns on the RuboCop pass. The first of these matters most:
  // the option is opt-in precisely so that the bytes this package has always
  // returned keep being returned, and a regression there breaks consumers who
  // never asked for RuboCop at all.
  it(
    'leaves output untouched when rubocop is not asked for',
    async () => {
      const source = 'class Client\n  attr_reader :base_url\n  def to_s\n    @base_url\n  end\nend\n'
      const expected = await format(source)

      expect(await format(source, { rubocop: false })).toBe(expected)
      expect(expected).toBe(source)
    },
    RUBOCOP_TIMEOUT_MS,
  )

  // Layout/EmptyLinesAroundAttributeAccessor and Layout/EmptyLineBetweenDefs.
  // syntax_tree does not insert blank lines at all, so these are corrections it
  // could never make on its own.
  it(
    'adds the blank lines rubocop wants around accessors and defs',
    async () => {
      const source = 'class Client\n  attr_reader :base_url\n  def to_s\n    @base_url\n  end\nend\n'

      expect(await format(source, { rubocop: true })).toBe(
        'class Client\n  attr_reader :base_url\n\n  def to_s\n    @base_url\n  end\nend\n',
      )
    },
    RUBOCOP_TIMEOUT_MS,
  )

  // Layout/EmptyLineAfterGuardClause.
  it(
    'adds a blank line after a guard clause',
    async () => {
      const source = 'def call(user)\n  return unless user\n  user.name\nend\n'

      expect(await format(source, { rubocop: true })).toBe('def call(user)\n  return unless user\n\n  user.name\nend\n')
    },
    RUBOCOP_TIMEOUT_MS,
  )

  // Layout/MultilineMethodCallIndentation - the disagreement that accounts for
  // most of what syntax_tree alone leaves behind. syntax_tree indents the
  // continuation of a broken chain; RuboCop's default aligns it.
  it(
    're-indents a wrapped method chain the way rubocop wants it',
    async () => {
      const source =
        'result = some_object.method_one.method_two(argument_one, argument_two).method_three(argument_four)\n'

      expect(await format(source, { rubocop: true })).toBe(
        'result =\n  some_object\n  .method_one\n  .method_two(argument_one, argument_two)\n  .method_three(argument_four)\n',
      )
    },
    RUBOCOP_TIMEOUT_MS,
  )

  // The pipeline has to reach a fixed point, or a consumer formatting on save
  // would see the file change on every keystroke.
  it(
    'is idempotent with the rubocop pass on',
    async () => {
      const once = await format('class A\n  attr_reader :b\n  def c\n@b\n  end\nend', { rubocop: true })

      expect(await format(once, { rubocop: true })).toBe(once)
    },
    RUBOCOP_TIMEOUT_MS,
  )

  // The RuboCop pass is loaded into the VM on first use and stays there. A
  // plain format afterwards has to be unaffected by that.
  it(
    'leaves plain formatting alone after a rubocop pass has run',
    async () => {
      await format('def a\n  1\nend\n', { rubocop: true })

      expect(await format('x=1')).toBe('x = 1\n')
    },
    RUBOCOP_TIMEOUT_MS,
  )
})

describe('formatSync', () => {
  it('produces the same bytes as the async format', async () => {
    const source = 'class A\n  def initialize(b)\n@b=b\n  end\nend'
    const expected = await format(source)
    expect(formatSync(source)).toBe(expected)
  })

  it('honours the same options', async () => {
    await init()
    expect(formatSync('x=1', { printWidth: 100 })).toBe('x = 1\n')
  })

  it('reports a parse failure rather than returning the source unchanged', async () => {
    await init()
    expect(() => formatSync('def (')).toThrow()
  })

  it('stays usable after a failed format', async () => {
    await init()
    expect(() => formatSync('def (')).toThrow()
    expect(formatSync('class A\n  def initialize(b)\n@b=b\n  end\nend')).toBe(
      'class A\n  def initialize(b)\n    @b = b\n  end\nend\n',
    )
  })

  it('returns a string rather than a promise, which is the whole point', async () => {
    await init()
    const result = formatSync('x=1') as unknown
    expect(result).toBeString()
    expect(result).not.toHaveProperty('then')
  })

  // Requiring RuboCop is synchronous Ruby, so formatSync can ask for it too -
  // its first such call is simply a slow one, and the bytes are the same.
  it(
    'runs the rubocop pass and produces the same bytes as format',
    async () => {
      await init()
      const source = 'class A\n  attr_reader :b\n  def c\n@b\n  end\nend'
      const expected = await format(source, { rubocop: true })

      expect(formatSync(source, { rubocop: true })).toBe(expected)
    },
    RUBOCOP_TIMEOUT_MS,
  )
})
