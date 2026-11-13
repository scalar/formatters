import { nodeArtifact } from './compile-artifact'
import { createFormat } from './format'
// The wired entry point, because `format` bound to the on-disk artifact is what
// a Node consumer actually gets. `createFormat` is used directly only where a
// test needs a formatter nothing else has booted.
import { format, formatSync, init } from './index'
import { createRbcop } from './rbcop'
import type { FormatOptions } from './types'
import { describe, expect, it } from 'bun:test'

/**
 * Inputs that between them reach most of what the pass does: indentation,
 * blank lines, spacing, alignment of wrapped calls and chains, heredocs,
 * multi-byte text, and lines long enough for Layout/LineLength to break.
 */
const SAMPLES: Record<string, string> = {
  'class body': 'class A\n  def initialize(b)\n@b=b\n  end\nend',
  'attribute accessor then method': 'class Client\n  attr_reader :base_url\n  def to_s\n    @base_url\n  end\nend\n',
  'guard clause': 'def call(user)\n  return unless user\n  user.name\nend\n',
  'spacing inside a block and a hash': 'x=[1,2,3].map{|n| n*2}\ny={a:1,b:2}\n',
  'wrapped arguments': 'register(a_reasonably_long_argument,\n        another_long_argument,\n    and_a_third)\n',
  'wrapped chain': 'result = some_object\n  .method_one\n      .method_two(argument)\n',
  heredoc: 'def usage\n  puts <<~TEXT\n    Usage: client [options]\n  TEXT\nend\n',
  'multi-byte text': 'class A\n  LABEL = "café 🌍"\n    def x\n  1\n    end\nend\n',
  'a long call': `result = client.request(method: :get, path: "/v1/items", query: { page: 1, per_page: 100 }, headers: { "accept" => "json" })\n`,
}

/**
 * A Sorbet `.rbi`: `sig` blocks in both spellings and empty method bodies, in
 * both of theirs. Nothing about it needs special handling - it is Ruby, and the
 * pass treats it as Ruby - which is the claim the tests below hold.
 */
const RBI = `# typed: strict
class Client
  extend T::Sig
  sig { params(base_url: String, token: T.nilable(String)).void }
  def initialize(base_url:, token: nil); end
  sig do
    params(
      path: String,
        query: T::Hash[Symbol, T.untyped]
    ).returns(T.untyped)
  end
  def get(path, query: {})
  end
    sig { returns(String) }
  def base_url; end
end
`

const LONG_CALL = SAMPLES['a long call'] ?? ''

describe('format', () => {
  it('formats a class body', async () => {
    expect(await format('class A\n  def initialize(b)\n@b=b\n  end\nend')).toBe(
      'class A\n  def initialize(b)\n    @b = b\n  end\nend\n',
    )
  })

  // Layout/EmptyLineAfterGuardClause and Layout/EmptyLinesAroundAttributeAccessor:
  // blank lines are the clearest sign that RuboCop itself ran.
  it('inserts the blank lines RuboCop wants', async () => {
    expect(await format(SAMPLES['guard clause'] ?? '')).toBe(
      'def call(user)\n  return unless user\n\n  user.name\nend\n',
    )
    expect(await format(SAMPLES['attribute accessor then method'] ?? '')).toBe(
      'class Client\n  attr_reader :base_url\n\n  def to_s\n    @base_url\n  end\nend\n',
    )
  })

  // The two entry points run the same code once booted, so this is the whole
  // contract between them, held over every sample and both widths.
  it('produces the same bytes from format and formatSync', async () => {
    for (const options of [{}, { printWidth: 60 }] satisfies FormatOptions[]) {
      for (const source of [...Object.values(SAMPLES), RBI]) {
        expect(formatSync(source, options)).toBe(await format(source, options))
      }
    }
  })

  // RuboCop corrects in a loop until nothing changes, so what comes out is
  // already a fixed point. A consumer formatting on save depends on that.
  it('leaves its own output unchanged on a second pass', async () => {
    for (const options of [{}, { printWidth: 60 }, { printWidth: 40 }] satisfies FormatOptions[]) {
      for (const source of [...Object.values(SAMPLES), RBI]) {
        const once = await format(source, options)
        expect(await format(once, options)).toBe(once)
      }
    }
  })

  // What this package does not do, held in place so that nobody mistakes it
  // for a reprinter: RuboCop corrects Layout within the lines it is handed.
  it('does not reprint one-line definitions into one statement per line', async () => {
    expect(await format('def x; a; b; end\n')).toBe('def x; a; b; end\n')
  })

  it('rejects unparseable input rather than returning it', async () => {
    await expect(format('def broken(')).rejects.toThrow(/not valid Ruby.*line 1/)
    expect(() => formatSync('class A\n  def x\nend')).toThrow(/not valid Ruby/)
  })

  // Native RuboCop 1.92.2 reports "Infinite loop detected" on exactly this
  // source and config: tab indentation and separator-aligned hashes, broken at
  // 20 columns, never stop rearranging each other. The pass gives up the same
  // way, and nothing half-corrected is returned.
  it('rejects a correction that never settles', async () => {
    const source =
      'class Client\n  def initialize(base_url:, token: nil, timeout: 30, retries: 3, logger: nil)\n' +
      '    @opts = { timeout: timeout, retries: retries, logger: logger, headers: { "a" => 1, "bb" => 2 } }\n' +
      '  end\n  def call(path, params = {})\n    foo(aaaa,\n      bbbb, cccc)\n    x = if value\n    end\n  end\nend'
    const options: FormatOptions = {
      printWidth: 20,
      rubocopConfig: {
        'Layout/HashAlignment': { EnforcedHashRocketStyle: 'key', EnforcedColonStyle: 'separator' },
        'Layout/IndentationStyle': { EnforcedStyle: 'tabs' },
        'Layout/MultilineHashKeyLineBreaks': { Enabled: true },
      },
    }

    await expect(format(source, options)).rejects.toThrow(/could not settle.*Infinite loop detected/)
    expect(() => formatSync(source, options)).toThrow(/could not settle/)
  })

  // At RuboCop's default of 120 the call is broken once; at 80 it is broken
  // earlier. Both breaks are at the argument list, the only place the cop can.
  it('maps printWidth to Layout/LineLength', async () => {
    expect(await format(LONG_CALL)).toBe(
      'result = client.request(method: :get, path: "/v1/items", query: { page: 1, per_page: 100 },\n' +
        '                        headers: { "accept" => "json" })\n',
    )
    expect(await format(LONG_CALL, { printWidth: 80 })).toBe(
      'result = client.request(method: :get, path: "/v1/items",\n' +
        '                        query: { page: 1, per_page: 100 }, headers: { "accept" => "json" })\n',
    )
  })

  it('lets a caller Layout/LineLength entry override printWidth', async () => {
    const options = { printWidth: 80, rubocopConfig: { 'Layout/LineLength': { Max: 200 } } }

    expect(await format(LONG_CALL, options)).toBe(LONG_CALL)
  })

  // The cop's autocorrect breaks argument lists and collection literals and
  // nothing else, so a line with neither stays as long as it was.
  it('leaves a long string literal long', async () => {
    const source = `MESSAGE = "${'x'.repeat(150)}"\n`

    expect(await format(source, { printWidth: 80 })).toBe(source)
  })

  it('formats an .rbi like any other Ruby', async () => {
    expect(await format(RBI)).toBe(
      [
        '# typed: strict',
        '',
        'class Client',
        '  extend T::Sig',
        '  sig { params(base_url: String, token: T.nilable(String)).void }',
        '  def initialize(base_url:, token: nil); end',
        '  sig do',
        '    params(',
        '      path: String,',
        '      query: T::Hash[Symbol, T.untyped]',
        '    ).returns(T.untyped)',
        '  end',
        '  def get(path, query: {})',
        '  end',
        '  sig { returns(String) }',
        '  def base_url; end',
        'end',
        '',
      ].join('\n'),
    )
  })

  // `sig` before a `def` is ordinary Ruby to RuboCop, so it adds no blank line
  // between the two, and an empty body on one line stays on one line.
  it('keeps sig blocks against their methods and empty bodies on one line', async () => {
    const source = 'class A\n  sig { void }\n  def x; end\n\n  sig { void }\n  def y; end\nend\n'

    expect(await format(source)).toBe(source)
  })

  it('preserves comments and #{} interpolation as written', async () => {
    const source = '# leading\nputs "hi #{name}" # trailing\nx = "#{`echo pwned`}"\n'

    expect(await format(source)).toBe(source)
  })

  it('handles UTF-8 without corrupting bytes', async () => {
    expect(await format('x = "héllo wörld 🌍"\n')).toBe('x = "héllo wörld 🌍"\n')
  })

  it('merges rubocopConfig over the config this package sets', async () => {
    const source = 'class A\n  def b\n    c = 1\n    c\n  end\nend\n'

    expect(await format(source, { rubocopConfig: { 'Layout/IndentationWidth': { Width: 4 } } })).toBe(
      'class A\n    def b\n        c = 1\n        c\n    end\nend\n',
    )
  })

  it('rejects a printWidth that is not a positive integer', async () => {
    await expect(format('a=1', { printWidth: 0 })).rejects.toThrow(TypeError)
    expect(() => formatSync('a=1', { printWidth: 2.5 })).toThrow(TypeError)
  })

  // `rubocop: false` used to mean "the reprinter alone". There is nothing left to
  // run without RuboCop, and returning the input would pass for formatting.
  it('refuses the removed rubocop: false rather than returning the input', async () => {
    const removed = { rubocop: false } as FormatOptions

    await expect(format('x=1', removed)).rejects.toThrow(/`rubocop` option has been removed/)
    expect(() => formatSync('x=1', removed)).toThrow(TypeError)
  })

  // `true` is the only behaviour there is, so it is not worth breaking a caller
  // over.
  it('accepts rubocop: true as a no-op', async () => {
    expect(await format('x=1', { rubocop: true } as FormatOptions)).toBe('x = 1\n')
  })

  // ERB and remote inherit_from need a Ruby to run, and the pass has none.
  it('reports a config the pass cannot load, and carries on after it', async () => {
    const remote = { rubocopConfig: { inherit_from: 'https://example.com/rubocop.yml' } }

    await expect(format('x = 1\n', remote)).rejects.toThrow(/only a Ruby can do/)
    expect(await format('x=1')).toBe('x = 1\n')
  })

  // Under Node every step of booting is synchronous, so a formatter nothing has
  // booted - no init, no format - still answers synchronously.
  it('formats synchronously with no init at all', () => {
    const fresh = createFormat(createRbcop(nodeArtifact))

    expect(fresh.formatSync('x=1')).toBe('x = 1\n')
  })

  it('returns a string rather than a promise from formatSync', () => {
    const result = formatSync('x=1') as unknown

    expect(result).toBeString()
    expect(result).not.toHaveProperty('then')
  })

  // Kept for compatibility, and only moves the cold start under Node.
  it('treats init as optional and repeatable', async () => {
    await init()
    await init()

    expect(formatSync('x=1')).toBe('x = 1\n')
  })

  // A config value of the wrong type panics inside rbcop - RuboCop raises a
  // TypeError at the same point - and a Rust panic traps the wasm instance. The
  // format that hit it fails, and the next one works on a fresh instance,
  // without anything having to be awaited in between.
  it('recovers from a crash in the pass synchronously', () => {
    const bad = { rubocopConfig: { 'Layout/IndentationWidth': { Width: 'four' } } }
    const source = 'class A\n    def x\n  1\n end\nend\n'

    expect(() => formatSync(source, bad)).toThrow(/crashed/)
    expect(formatSync(source)).toBe('class A\n  def x\n    1\n  end\nend\n')
  })

  it('recovers from a crash in the pass for format too', async () => {
    const bad = { rubocopConfig: { 'Layout/IndentationWidth': { Width: 'four' } } }
    const source = 'class A\n    def x\n  1\n end\nend\n'

    await expect(format(source, bad)).rejects.toThrow(/crashed/)
    expect(await format(source)).toBe('class A\n  def x\n    1\n  end\nend\n')
  })
})
