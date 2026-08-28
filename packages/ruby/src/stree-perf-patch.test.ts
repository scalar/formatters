// The patch in stree-perf-patch.ts swaps the string `on_comment` walks
// backwards over for one that answers the same three questions in constant
// time. It is a speed change and nothing else, so what these assert is that the
// substitution is faithful: a comment is classified the same way whether or not
// the source around it carries a multi-byte character.
//
// The other half of the guard is native-conformance.test.ts, which puts a
// source shaped like this one through the real gem on a native Ruby and asserts
// byte-identical output.

import { format, init } from './index'
import { nodeVm } from './node-vm'
import { beforeAll, describe, expect, it } from 'bun:test'

/** Generous for the same reason format.test.ts's is: this boots the artifact. */
const WARMUP_TIMEOUT_MS = 120_000

beforeAll(async () => {
  await init()
}, WARMUP_TIMEOUT_MS)

/**
 * Every shape the backward walk has to tell apart, with one character of the
 * caller's choosing sitting in the middle of them.
 *
 * The comments after the marker are the ones that matter: `on_comment` decides
 * inline from standalone by counting characters back from the `#`, so a
 * multi-byte character *earlier in the file* is what moves a character offset
 * out of step with a byte offset. Passing `é` and `e` through the same shape is
 * how the two runs stay comparable - both are one character, so every offset
 * after them is identical.
 */
const commentShapes = (marker: string) => `# a standalone comment
class Report # an inline comment
  # ${marker} an indented standalone comment
  def total(rows) # inline after a def
    rows.sum # inline after code
  end
end
`

describe('the on_comment scan source', () => {
  // `rubocop: false` throughout: the claim is about syntax_tree's parser, and
  // the Layout pass would be a second thing deciding where a comment lands.
  it('classifies comments the same with and without a multi-byte character', async () => {
    const wide = await format(commentShapes('é'), { rubocop: false })
    const ascii = await format(commentShapes('e'), { rubocop: false })

    expect(wide.replaceAll('é', 'e')).toBe(ascii)
  })

  it('keeps inline and standalone comments apart after a multi-byte character', async () => {
    const out = await format(commentShapes('é'), { rubocop: false })

    expect(out).toContain('\n  # é an indented standalone comment\n')
    expect(out).toContain('rows.sum # inline after code')
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
        source = "x = 1 # inline\\n__END__\\n\\xC3".dup.force_encoding("UTF-8")
        raise "the sample is supposed to have an invalid encoding" if source.valid_encoding?

        parser = SyntaxTree::Parser.new(source)
        parser.parse
        parser.comments.map { |comment| [comment.value, comment.inline?] }.inspect
      `)
      .toString()

    expect(result).toBe('[["# inline", true]]')
  })
})
