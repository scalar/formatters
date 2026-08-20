// Imports the wired entry point rather than `createFormat`, because `format`
// bound to the on-disk artifact is what a Node consumer actually gets.
import { createBootVm } from './boot-vm'
import { compileArtifact } from './compile-artifact'
import { createFormat } from './format'
import { format, formatSync, init } from './index'
import type { FormatOptions } from './types'
import { beforeAll, describe, expect, it } from 'bun:test'

/**
 * Generous, because this boots the VM *and* requires RuboCop: 698 cop files,
 * read and evaluated by a Ruby running on wasm, which takes several seconds.
 */
const WARMUP_TIMEOUT_MS = 120_000

// Warmed up front rather than left to whichever test happens to run first. The
// RuboCop pass is on by default, so without this the load lands on an arbitrary
// test and blows its timeout - and which test that is depends on run order.
beforeAll(async () => {
  await init()
}, WARMUP_TIMEOUT_MS)

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
    const out = await format('case s\nin 300.. | 400.. then\n  a\nend\n', { rubocop: false })
    expect(out).toBe('case s\nin 300.. | 400.. then\n  a\nend\n')
  })

  it('keeps then when unwrapping a hash pattern leaves a trailing endless range', async () => {
    const out = await format('case s\nin { status: 400.. } then\n  a\nend\n', { rubocop: false })
    expect(out).toBe('case s\nin status: 400.. then\n  a\nend\n')
  })

  it('omits then when the endless range is not the last thing in the pattern', async () => {
    const out = await format('case s\nin { status: 400.., body: String } then\n  a\nend\n', { rubocop: false })
    expect(out).toBe('case s\nin { status: 400.., body: String }\n  a\nend\n')
  })

  // A string that happens to end in dots is not an endless range. Deciding on
  // the rendered pattern rather than on its node types is what keeps this from
  // growing a stray `then`.
  it('does not add then for a literal that merely ends in dots', async () => {
    const out = await format('case s\nin { m: "ends.." } then\n  a\nend\n', { rubocop: false })
    expect(out).toBe('case s\nin m: "ends.."\n  a\nend\n')
  })

  // Every case/in shape above is only interesting because the output has to be
  // parseable, so assert that directly on the one that used to break.
  it('returns Ruby that parses for endless range patterns', async () => {
    const out = await format('case s\nin 300.. | 400.. then\n  a\nend\n', { rubocop: false })
    expect(format(out, { rubocop: false })).resolves.toBe(out)
  })

  // A guard cannot be fixed with `then` - the guard already sits where `then`
  // would go, and `in 400.. then if g` is not Ruby. The parentheses the author
  // wrote are the only legal spelling, and syntax_tree drops them: the clause
  // reaches the formatter as an `IfNode` with no record that they were there.
  //
  // Each of these arrives at a trailing `..` by a different route, and the last
  // two are the ones plain parentheses would not have fixed on their own - a
  // bare hash pattern has to keep its braces inside them.
  const GUARDED: Record<string, [source: string, expected: string]> = {
    'a bare endless range': ['case s\nin (400..) if g\n  a\nend\n', 'case s\nin (400..) if g\n  a\nend\n'],
    'an unless guard': ['case s\nin (400..) unless g\n  a\nend\n', 'case s\nin (400..) unless g\n  a\nend\n'],
    'an alternative': ['case s\nin Foo | (500..) if g\n  a\nend\n', 'case s\nin (Foo | 500..) if g\n  a\nend\n'],
    'a hash pattern': ['case s\nin {x: (500..)} if g\n  a\nend\n', 'case s\nin ({ x: 500.. }) if g\n  a\nend\n'],
    'a bare double splat': ['case s\nin {**} if g\n  a\nend\n', 'case s\nin ({ ** }) if g\n  a\nend\n'],
  }

  for (const [shape, [source, expected]] of Object.entries(GUARDED)) {
    it(`keeps the parentheses a guarded clause needs around ${shape}`, async () => {
      const out = await format(source, { rubocop: false })

      expect(out).toBe(expected)
      // Re-formatting is the real assertion: the VM re-parses before it returns,
      // so a second pass that comes back unchanged is the output parsing.
      expect(await format(out, { rubocop: false })).toBe(out)
    })
  }

  // Writing `then` defensively does not survive stock syntax_tree either, since
  // that `then` is not in the tree - so this has to come back parenthesised too.
  it('handles a guarded clause that already carries a redundant then', async () => {
    const out = await format('case s\nin (400..) if g then\n  a\nend\n', { rubocop: false })

    expect(out).toBe('case s\nin (400..) if g\n  a\nend\n')
    expect(await format(out, { rubocop: false })).toBe(out)
  })

  // A guarded clause whose pattern closes itself needs nothing added, and adding
  // parentheses anyway would be churn on every file that has one.
  it('leaves a guarded clause alone when the pattern terminates itself', async () => {
    const out = await format('case s\nin [1, (500..)] if g\n  a\nend\n', { rubocop: false })

    expect(out).toBe('case s\nin [1, 500..] if g\n  a\nend\n')
  })

  // stock syntax_tree prints this ` then` inside the braces - `in { a: 1, ** then }`
  // - which Ruby rejects with "unexpected 'then', expecting '}'". The braces
  // already do the job the `then` was there for, so it is dropped rather than
  // moved outside them.
  it('does not print then inside a hash pattern that has braces', async () => {
    const out = await format('case r\nin {a: 1, **}\n  x\nend\n', { rubocop: false })

    expect(out).toBe('case r\nin { a: 1, ** }\n  x\nend\n')
    expect(await format(out, { rubocop: false })).toBe(out)
  })

  // The one rendering with no braces to close it. Without `then`, `x` on the
  // next line is read as the splat's name and the clause body silently empties.
  it('keeps then after a bare double splat that prints without braces', async () => {
    const out = await format('case r\nin {**}\n  x\nend\n', { rubocop: false })

    expect(out).toBe('case r\nin ** then\n  x\nend\n')
  })

  // An exponent is an `Op` named `:**` that nothing else consumes, so it sits in
  // syntax_tree's token list until a later hash pattern's unbounded reverse
  // search adopts it as a double splat that was never written. `n ** 2` avoids
  // it, but syntax_tree normalises that back to `n**2`, so it returns next run.
  const STRAY_SPLAT: Record<string, [source: string, expected: string]> = {
    'a two-key pattern': [
      'x = n**2\ncase r\nin {a: 1, b: 2}\n  y\nend\n',
      'x = n**2\ncase r\nin { a: 1, b: 2 }\n  y\nend\n',
    ],
    'a single-key pattern': ['x = n**2\ncase r\nin {a: 1}\n  y\nend\n', 'x = n**2\ncase r\nin a: 1\n  y\nend\n'],
    'a constant pattern': ['x = n**2\ncase r\nin Foo[a: 1]\n  y\nend\n', 'x = n**2\ncase r\nin Foo[a: 1]\n  y\nend\n'],
    // `in {}` matches only an empty hash and `in **` matches any hash at all, so
    // this one parsed fine and meant something else - the worst of the family.
    'an empty pattern': ['x = n**2\ncase r\nin {}\n  y\nend\n', 'x = n**2\ncase r\nin {}\n  y\nend\n'],
  }

  for (const [shape, [source, expected]] of Object.entries(STRAY_SPLAT)) {
    it(`does not adopt an earlier exponent as the double splat of ${shape}`, async () => {
      expect(await format(source, { rubocop: false })).toBe(expected)
    })
  }

  // The same search, from the other direction: here the stray `**` is inside the
  // pattern rather than before it, and it is refused for the same reason - it
  // starts before the pattern's last keyword ends.
  it('does not adopt a pin expression exponent as the double splat', async () => {
    const out = await format('case r\nin {a: ^(n**2), b: 2}\n  y\nend\n', { rubocop: false })

    expect(out).toBe('case r\nin { a: ^(n**2), b: 2 }\n  y\nend\n')
    expect(await format(out, { rubocop: false })).toBe(out)
  })

  // The bound has to leave the genuine article alone, whichever spelling it is
  // in and whether or not there is an exponent in the file to confuse it with.
  it('still finds the double splat a pattern really has', async () => {
    expect(await format('x = n**2\ncase r\nin {a: 1, **}\n  y\nend\n', { rubocop: false })).toBe(
      'x = n**2\ncase r\nin { a: 1, ** }\n  y\nend\n',
    )
    expect(await format('case r\nin {a: 1, **rest}\n  y\nend\n', { rubocop: false })).toBe(
      'case r\nin { a: 1, **rest }\n  y\nend\n',
    )
    expect(await format('case r\nin {a: 1, **nil}\n  y\nend\n', { rubocop: false })).toBe(
      'case r\nin { a: 1, **nil }\n  y\nend\n',
    )
  })

  // Layout/EmptyLinesAroundAttributeAccessor and Layout/EmptyLineBetweenDefs.
  // syntax_tree does not insert blank lines at all, so these are corrections it
  // could never make on its own - which makes this input a clean probe for
  // whether the RuboCop pass ran.
  const NEEDS_RUBOCOP = 'class Client\n  attr_reader :base_url\n  def to_s\n    @base_url\n  end\nend\n'
  const AFTER_RUBOCOP = 'class Client\n  attr_reader :base_url\n\n  def to_s\n    @base_url\n  end\nend\n'

  // The default, and the reason the default is what it is: syntax_tree alone
  // returns this input unchanged, and RuboCop would reject it.
  it('runs the rubocop pass when no option is given', async () => {
    expect(await format(NEEDS_RUBOCOP)).toBe(AFTER_RUBOCOP)
  })

  it('runs it when asked for explicitly', async () => {
    expect(await format(NEEDS_RUBOCOP, { rubocop: true })).toBe(AFTER_RUBOCOP)
  })

  // The escape hatch, for callers who want syntax_tree on its own and none of
  // what RuboCop costs.
  it('skips the pass when opted out, leaving syntax_tree alone', async () => {
    expect(await format(NEEDS_RUBOCOP, { rubocop: false })).toBe(NEEDS_RUBOCOP)
  })

  // RuboCop's Style/MultilineInPatternThen removes the `then` a pattern ending in
  // an endless range cannot do without, and the result does not parse - the next
  // line is swallowed into the range. It is a Style cop and this pass is
  // `--only Layout`, so it never runs, but the two tools now ship together and
  // that is worth holding in place. See the README for the `.rubocop.yml` entry a
  // consumer running a full `rubocop -a` afterwards wants.
  it('leaves the mandatory then alone when the rubocop pass runs', async () => {
    const source = 'case status\nin 500.. then\n  retry_request\nend\n'

    expect(await format(source)).toBe(source)
  })

  // Layout/EmptyLineAfterGuardClause.
  it('adds a blank line after a guard clause', async () => {
    const source = 'def call(user)\n  return unless user\n  user.name\nend\n'

    expect(await format(source)).toBe('def call(user)\n  return unless user\n\n  user.name\nend\n')
  })

  // Layout/MultilineMethodCallIndentation - the disagreement that accounts for
  // most of what syntax_tree alone leaves behind. syntax_tree indents the
  // continuation of a broken chain; RuboCop's default aligns it.
  it('re-indents a wrapped method chain the way rubocop wants it', async () => {
    const source =
      'result = some_object.method_one.method_two(argument_one, argument_two).method_three(argument_four)\n'

    expect(await format(source)).toBe(
      'result =\n  some_object\n  .method_one\n  .method_two(argument_one, argument_two)\n  .method_three(argument_four)\n',
    )
  })

  // The pipeline has to reach a fixed point, or a consumer formatting on save
  // would see the file change on every keystroke.
  it('is idempotent', async () => {
    const once = await format('class A\n  attr_reader :b\n  def c\n@b\n  end\nend')

    expect(await format(once)).toBe(once)
  })

  // The RuboCop pass is loaded into the VM once and stays there. Opting out
  // afterwards has to be unaffected by that.
  it('honours an opt-out after a rubocop pass has run', async () => {
    await format(NEEDS_RUBOCOP)

    expect(await format(NEEDS_RUBOCOP, { rubocop: false })).toBe(NEEDS_RUBOCOP)
  })

  // printWidth belongs to syntax_tree, and RuboCop's Layout/LineLength is off so
  // that it cannot contradict it. With the cop on at its default Max of 120,
  // this came back rewrapped at 124 - neither the width asked for nor the cop's.
  it('honours a printWidth above RuboCop default line length', async () => {
    const source =
      'result = some_object.method_one(argument_one_here, argument_two_here, argument_five).method_two(argument_three, argument_four, argument_six)\n'

    expect(await format(source, { printWidth: 200 })).toBe(await format(source, { printWidth: 200, rubocop: false }))
  })

  // Two Layout offenses that syntax_tree's own output introduces, so the pass is
  // the thing that should be clearing them. RuboCop 1.74.0 corrected neither:
  // its Layout/SpaceInsideHashLiteralBraces did not look at hash *patterns*, and
  // its Layout/SpaceAroundKeyword did not flag the `return(` wrapping syntax_tree
  // emits when a `return <call>` exceeds printWidth. Both are why the bundled
  // RuboCop moved to 1.81.6.
  it('corrects space inside a hash pattern, not only a hash literal', async () => {
    const config = { rubocopConfig: { 'Layout/SpaceInsideHashLiteralBraces': { EnforcedStyle: 'no_space' } } }

    expect(await format('x = {a: 1, b: 2}', config)).toBe('x = {a: 1, b: 2}\n')
    expect(await format('case r\nin {event: "error", data: String => data}\n  y\nend\n', config)).toBe(
      'case r\nin {event: "error", data: String => data}\n  y\nend\n',
    )
  })

  // Long enough, and deep enough, that syntax_tree has to break the call - which
  // is what produces the `return(` this is about.
  it('corrects the space after return in syntax_tree own wrapping', async () => {
    const source =
      'module M\n  class C\n    class D\n      private def f(y, val:, closing:, content_type: nil)\n' +
      '        case val\n        in FilePart\n' +
      '          return write_multipart_content(y, val: val.content, closing: closing, content_type: val.content_type)\n' +
      '        end\n      end\n    end\n  end\nend\n'

    const out = await format(source, { printWidth: 110 })

    expect(out).toContain('return (')
    expect(out).not.toContain('return(')
    expect(await format(out, { printWidth: 110 })).toBe(out)
  })

  // The escape hatch, and the way to put Layout/LineLength back.
  it('merges rubocopConfig over the config this package sets', async () => {
    const source = 'class A\n  def b\n    c = 1\n    c\n  end\nend\n'

    expect(await format(source, { rubocopConfig: { 'Layout/IndentationWidth': { Width: 4 } } })).toBe(
      'class A\n    def b\n        c = 1\n        c\n    end\nend\n',
    )
  })

  // A caller-supplied config carries strings, and Ruby evaluates #{...} inside
  // double quotes - so it goes through the guest filesystem like the source
  // does, never through interpolation.
  it('does not evaluate #{} interpolation in a rubocopConfig value', async () => {
    const source = 'x=1\n'

    expect(
      await format(source, {
        rubocopConfig: { 'Layout/IndentationWidth': { Width: 2, Description: '#{`echo pwned`}' } },
      }),
    ).toBe('x = 1\n')
  })
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

  // `init` loads RuboCop, so the synchronous path gets the default pass without
  // a first-call stall - and the same bytes as the asynchronous one.
  it('runs the rubocop pass and produces the same bytes as format', async () => {
    await init()
    const source = 'class A\n  attr_reader :b\n  def c\n@b\n  end\nend'

    expect(formatSync(source)).toBe(await format(source))
  })
})

describe('init', () => {
  // `formatSync` requires `init`, so without an argument here a synchronous
  // caller could skip the RuboCop pass per call but never avoid loading it.
  // Built on its own VM because the shared one has RuboCop loaded already, and
  // the claim is precisely that this one does not.
  it('leaves RuboCop unloaded when asked not to', async () => {
    const vm = createBootVm(compileArtifact)
    const own = createFormat(vm)

    await own.init({ rubocop: false })

    expect(vm.peek()?.rubocopLoaded).toBe(false)
    expect(own.formatSync('x=1', { rubocop: false })).toBe('x = 1\n')
  }, 120_000)

  it('loads RuboCop by default, so the first formatSync does not stall', async () => {
    const vm = createBootVm(compileArtifact)
    const own = createFormat(vm)

    await own.init()

    expect(vm.peek()?.rubocopLoaded).toBe(true)
  }, 120_000)
})
