// The patch in stree-perf-patch.ts swaps the string `on_comment` walks
// backwards over for one that answers the same three questions in constant
// time. It is a speed change and nothing else, so what these assert is that the
// substitution is faithful: a comment is classified the same way whether or not
// the source before it carries multi-byte characters.
//
// The other half of the guard is native-conformance.test.ts, which puts a
// source shaped like this one through the real gem on a native Ruby and asserts
// byte-identical output.

import { format, init } from './index'
import { nodeVm } from './node-vm'
import { DERIVED_FROM_SYNTAX_TREE } from './stree-perf-patch'
import { beforeAll, describe, expect, it } from 'bun:test'

/** Generous for the same reason format.test.ts's is: this boots the artifact. */
const WARMUP_TIMEOUT_MS = 120_000

beforeAll(async () => {
  await init()
}, WARMUP_TIMEOUT_MS)

/**
 * Every shape the backward walk has to tell apart, with four characters of the
 * caller's choosing sitting ahead of them.
 *
 * Four rather than one, and ahead of the comments rather than among them,
 * because a scan source whose offsets have drifted still lands on *some*
 * character - and any character that is not a space, tab or newline answers
 * "inline". Only a standalone comment reached across accumulated drift can tell
 * a correct index from a plausible one, and only if the line above it ends in
 * something that is not whitespace, so a drifted index has content to hit.
 *
 * `é` and `e` are interchangeable here because both are one character: every
 * offset after them is identical, so the two runs stay comparable.
 */
const commentShapes = (accent: string): string => `# a standalone comment
module Billing
  LABELS = { moeda: "R$", nota: "${accent}${accent}${accent}${accent}" }.freeze
  # a standalone comment reached across the drift
\t# a tab-indented standalone comment
  def unit_price(plan) # inline after a def
    plan.fetch(:moeda) # inline after code
  end
end
`

describe('stree-perf-patch', () => {
  // The retirement signal. `on_comment` here is a frozen copy of one gem
  // version's, and unlike the correctness patches nothing about a *newer* gem
  // would fail on its own - the copy would just keep overriding whatever
  // upstream wrote, output-identically, including an upstream fix for this very
  // cost. So the version is asserted directly: bump the pin in
  // build/ruby_fmt/Gemfile, rebuild the artifact, and this is what tells you the
  // copy has to be re-derived or dropped.
  it('still runs the syntax_tree the patch was copied from', async () => {
    const { vm } = await nodeVm.boot()

    expect(vm.eval('SyntaxTree::VERSION').toString()).toBe(DERIVED_FROM_SYNTAX_TREE)
  })

  // `rubocop: false` throughout: the claim is about syntax_tree's parser, and
  // the Layout pass would be a second thing deciding where a comment lands.
  it('classifies comments the same with and without multi-byte characters', async () => {
    const wide = await format(commentShapes('é'), { rubocop: false })
    const ascii = await format(commentShapes('e'), { rubocop: false })

    expect(wide.replaceAll('é', 'e')).toBe(ascii)
  })

  it('keeps inline and standalone comments apart across multi-byte drift', async () => {
    const out = await format(commentShapes('é'), { rubocop: false })

    expect(out).toContain('\n  # a standalone comment reached across the drift\n')
    expect(out).toContain('\n  # a tab-indented standalone comment\n')
    expect(out).toContain('plan.fetch(:moeda) # inline after code')
  })

  // The assertions about the mechanism rather than the output, and the only
  // ones that fail if the patch is never applied - every other test here passes
  // against stock syntax_tree, which gets these inputs right and merely takes
  // quadratic time over them.
  //
  // Read through a real parse rather than by calling the helper: the ivar can
  // only be set if `on_comment` asked for it, so this is also what catches the
  // patch staying installed while the walk quietly goes back to reading
  // `source` - which costs the entire win and changes not one byte of output.
  it('builds one ASCII scan source, of the same length as the source, per parse', async () => {
    const { vm } = await nodeVm.boot()

    const result = vm
      .eval(`
        lambda do
          source = "# a comment\\n  # indented after caf\\u00E9\\nx = 1 # inline\\n"
          parser = SyntaxTree::Parser.new(source)
          parser.parse
          scan = parser.instance_variable_get(:@scalar_whitespace_scan_source)

          [
            !scan.nil?,
            scan.ascii_only?,
            scan.length == source.length,
            parser.send(:scalar_whitespace_scan_source).equal?(scan)
          ].inspect
        end.call
      `)
      .toString()

    expect(result).toBe('[true, true, true, true]')
  })

  // The other half of "built once per parse, and not at all for a source that
  // is already ASCII", which three places claim and nothing else checks. Its
  // loss is completely silent: drop the guard and every ASCII format pays a
  // source-sized `tr` and its allocation for a copy identical to what it
  // copied, with every other test still green. Identity rather than equality is
  // the whole assertion - an equal copy is exactly the failure.
  it('does not copy a source that already indexes in constant time', async () => {
    const { vm } = await nodeVm.boot()

    const result = vm
      .eval(`
        lambda do
          source = "# a comment\\n  # indented\\nx = 1 # inline\\n"
          parser = SyntaxTree::Parser.new(source)
          parser.parse

          parser.instance_variable_get(:@scalar_whitespace_scan_source).equal?(source).inspect
        end.call
      `)
      .toString()

    expect(result).toBe('true')
  })

  // The negative control for the test above. A scan source that answers "not
  // whitespace" everywhere reclassifies every comment as inline, so if the walk
  // were reading `source` instead, swapping this one out would change nothing.
  // Overridden per parser rather than on the class, so the swap cannot outlive
  // the test and reach another one through the shared VM.
  //
  // Two things about the fixture. Nothing sits at character 0, where `index`
  // starts at -1 and `inline` is false before the scan source is read at all.
  // And `parser.comments` keeps only what the tree did not absorb - `Statements`
  // adopts standalone comments and deletes them from the list as it binds - so
  // a walk reading `source` leaves one entry here, not three.
  it('reads the scan source rather than the source when it classifies', async () => {
    const { vm } = await nodeVm.boot()

    const result = vm
      .eval(`
        lambda do
          source = "x = 0\\n# standalone\\n  # indented standalone\\ny = 1 # inline\\n"
          parser = SyntaxTree::Parser.new(source)
          filler = "x" * source.length
          parser.define_singleton_method(:scalar_whitespace_scan_source) { filler }
          parser.parse

          parser.comments.map { |comment| comment.inline? }.inspect
        end.call
      `)
      .toString()

    expect(result).toBe('[true, true, true]')
  })

  // `format` cannot reach this: it writes the source into the guest as UTF-8 it
  // encoded itself, so what Ruby reads back is always valid. The parser can,
  // which is the reason the gem avoids `rindex` and regular expressions in this
  // loop and the reason the patch keeps a fallback - `tr` refuses such a string
  // too, and turning a source the gem can read into an exception would be a
  // real regression. Driven through the VM directly because nothing above it
  // can produce the input.
  it('falls back to the source itself when the encoding is invalid', async () => {
    const { vm } = await nodeVm.boot()

    const result = vm
      .eval(`
        lambda do
          source = "x = 1 # inline\\n__END__\\n\\xC3".dup.force_encoding("UTF-8")
          raise "the sample is supposed to have an invalid encoding" if source.valid_encoding?

          parser = SyntaxTree::Parser.new(source)
          parser.parse
          parser.comments.map { |comment| [comment.value, comment.inline?] }.inspect
        end.call
      `)
      .toString()

    expect(result).toBe('[["# inline", true]]')
  })
})
