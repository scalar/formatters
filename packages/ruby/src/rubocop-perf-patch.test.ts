// The patches in rubocop-perf-patch.ts swap the key `ProcessedSource#sorted_tokens`
// sorts on for one that compares as an Integer, and the walk
// `Parser::Source::Buffer#line_begins` makes over a multi-byte source for one
// that is linear in it. Both are speed changes and nothing else, so what these
// assert is that each substitution is faithful: the tokens come out in the
// order the gem's own expression puts them in, on every shape that reaches the
// sort, and the line table has the same entries whether or not the source
// carries multi-byte characters.
//
// The other half of the guard is test/rubocop-conformance.test.ts, which puts
// one source shaped for each patch through the real `rubocop` binary on a
// native Ruby and asserts byte-identical output.

import { File } from '@bjorn3/browser_wasi_shim'

import { WORK_DIR } from './boot-vm'
import { format, init } from './index'
import { nodeVm } from './node-vm'
import { buildRuboCopConfig } from './rubocop'
import { DERIVED_FROM_PARSER, DERIVED_FROM_RUBOCOP_AST } from './rubocop-perf-patch'
import { beforeAll, describe, expect, it } from 'bun:test'

/** Generous for the same reason format.test.ts's is: this boots the artifact. */
const WARMUP_TIMEOUT_MS = 120_000

/**
 * The package's own config, written into the guest under a name of this
 * file's, so that the `ProcessedSource`s below are parsed by the engine and
 * for the target version every real format uses - not the 2.7 floor RuboCop
 * falls back to with no config, which would reach for the `parser` gem instead
 * of prism and lex a different token stream.
 */
const CONFIG_NAME = 'rubocop-perf-patch.yml'

beforeAll(async () => {
  await init()
  const { workFiles } = await nodeVm.boot()
  workFiles.set(CONFIG_NAME, new File(new TextEncoder().encode(buildRuboCopConfig())))
}, WARMUP_TIMEOUT_MS)

/**
 * Sources whose token list arrives out of position order, so `sorted_tokens`
 * has to sort rather than hand `tokens` back.
 *
 * Every one has a heredoc, because a heredoc is what does it: its body is lexed
 * where it sits, after the tokens for the rest of the line that opened it. The
 * shapes vary what surrounds the body - nothing, more arguments, a second
 * heredoc whose body follows the first, interpolation inside the body, and a
 * heredoc nested in a block - so that the tokens being reordered land in
 * different places relative to each other.
 *
 * Written as Ruby string literals for the VM, so `\\n` here is a Ruby escape
 * and the `#{...}` is escaped for the same reason.
 */
const UNSORTED_SHAPES = [
  '"puts <<~TEXT\\n  hi\\nTEXT\\n"',
  '"template(<<~HTML, name)\\n  <p>hi</p>\\nHTML\\n"',
  '"render(<<~HTML, <<~CSS)\\n  <p>hi</p>\\nHTML\\n  p { }\\nCSS\\n"',
  '"puts(<<~TEXT, 1)\\n  \\#{name}\\nTEXT\\n"',
  '"run do\\n  call(<<~A, 2)\\n    x\\n  A\\nend\\n"',
]

/** Sources whose token list is already in order, so no sort runs. */
const SORTED_SHAPES = ['"x = 1\\ny = [1, 2]\\n"', '"x = \\"a\\#{b}c\\"\\n"', '""', '"# just a comment\\n"']

/**
 * Builds a `ProcessedSource` the way `ScalarRubyFmt#process` does, on the
 * package's own config, so the parser and target version are the ones every
 * format uses.
 */
const processedSource = (source: string): string =>
  `RuboCop::ProcessedSource.new(${source}, config.target_ruby_version, "/work/input.rb", parser_engine: config.parser_engine)`

/** The gem's own sort, verbatim, to compare the patched method against. */
const STOCK_SORT = 'ps.tokens.sort_by.with_index { |token, i| [token.begin_pos, i] }'

describe('rubocop-perf-patch', () => {
  // The retirement signal. `sorted_tokens` here is a frozen copy of one gem
  // version's, and nothing about a *newer* gem would fail on its own - the copy
  // would keep overriding whatever upstream wrote, output-identically,
  // including an upstream version of this very change. So the version is
  // asserted directly: bump the pin in build/ruby_fmt/Gemfile, rebuild the
  // artifact, and this is what tells you the copy has to be re-derived or
  // dropped.
  it('still runs the rubocop-ast the patch was derived from', async () => {
    const { vm } = await nodeVm.boot()

    expect(vm.eval('RuboCop::AST::Version::STRING').toString()).toBe(DERIVED_FROM_RUBOCOP_AST)
  })

  // Element for element and object for object - `equal?`, not `==` - against
  // the gem's expression evaluated on the same tokens. Each shape is first
  // checked to be one the sort actually runs on, so a fixture that stopped
  // reaching the patched branch would fail here rather than pass vacuously.
  it('orders tokens exactly as the gem’s stable sort does', async () => {
    const { vm } = await nodeVm.boot()

    for (const source of UNSORTED_SHAPES) {
      const result = vm
        .eval(`
          lambda do
            config = ScalarRubyFmt.config_for("${WORK_DIR}/${CONFIG_NAME}")
            ps = ${processedSource(source)}
            return "the fixture's tokens are already sorted" if ps.send(:tokens_sorted?)

            stock = ${STOCK_SORT}
            ours = ps.sorted_tokens
            return "different lengths: #{ours.size} against #{stock.size}" unless ours.size == stock.size

            ours.zip(stock).all? { |a, b| a.equal?(b) } ? "same" : "different order"
          end.call
        `)
        .toString()

      expect(result, `on ${source}`).toBe('same')
    }
  })

  // Memoisation is the gem's, not the patch's, but the patch replaces the
  // method it lives in - so this is what catches a copy that dropped the
  // `||=` and made every token-based cop sort again.
  it('sorts once per source', async () => {
    const { vm } = await nodeVm.boot()

    const result = vm
      .eval(`
        lambda do
          config = RuboCop::ConfigLoader.default_configuration
          ps = ${processedSource(UNSORTED_SHAPES[0] ?? '""')}
          ps.sorted_tokens.equal?(ps.sorted_tokens).inspect
        end.call
      `)
      .toString()

    expect(result).toBe('true')
  })

  // The other branch: a source already in order gets `tokens` itself back,
  // not a sorted copy of it. Identity is the assertion, because an equal copy
  // is a sort that ran for nothing.
  it('hands back the token list itself when it is already in order', async () => {
    const { vm } = await nodeVm.boot()

    for (const source of SORTED_SHAPES) {
      const result = vm
        .eval(`
          lambda do
            config = ScalarRubyFmt.config_for("${WORK_DIR}/${CONFIG_NAME}")
            ps = ${processedSource(source)}
            ps.sorted_tokens.equal?(ps.tokens).inspect
          end.call
        `)
        .toString()

      expect(result, `on ${source}`).toBe('true')
    }
  })

  // The second retirement signal, for the second gem. `parser` is a dependency
  // rather than a Gemfile pin, so the version here is the one the lockfile
  // resolved and the artifact was built with.
  it('still runs the parser the patch was derived from', async () => {
    const { vm } = await nodeVm.boot()

    expect(vm.eval('Parser::VERSION').toString()).toBe(DERIVED_FROM_PARSER)
  })

  // Entry for entry against the gem's own loop, evaluated here on the same
  // string, sentinel included. The shapes are the ones the two walks could
  // disagree on: no newline at all, a newline and nothing after it, a source
  // that does not end in one, CRLF endings, and multi-byte characters both
  // ahead of a newline and on the last line - which is the only case where the
  // walk sees a line it must not record. No invalid encoding among them:
  // `Buffer#source=` raises on one before `line_begins` could see it, so the
  // patch's fallback for that case is unreachable through a buffer.
  it('builds the same line table as the gem on every shape of source', async () => {
    const { vm } = await nodeVm.boot()

    const result = vm
      .eval(`
        lambda do
          stock = lambda do |source|
            begins = [0]
            index = 0
            while index = source.index("\\n".freeze, index)
              index += 1
              begins << index
            end
            begins << source.size + 1
            begins
          end

          shapes = [
            "", "\\n", "a", "a\\n", "a\\nb", "a\\r\\nb\\r\\n", "\\n\\n\\n",
            "\\u00E9", "\\u00E9\\n", "\\u00E9\\nab\\n", "a\\u00E9\\n\\nb", "ab\\n\\u00E9", "\\u3042\\n\\u3042\\n"
          ]

          # Compared on what the buffer holds rather than on what it was given:
          # the setter folds CRLF into LF before either walk sees the source.
          shapes.map do |source|
            buffer = Parser::Source::Buffer.new("(test)", 1)
            buffer.source = source
            buffer.line_begins == stock.call(buffer.source) ? "same" : "differs on #{source.inspect}"
          end.uniq.inspect
        end.call
      `)
      .toString()

    expect(result).toBe('["same"]')
  })

  // Through the whole pass, RuboCop on, because the line table is what every
  // cop's notion of "which line" rests on: a table with a drifted entry moves
  // a correction to the wrong line. The accented character sits ahead of the
  // correction this source needs - the blank line after `attr_reader` - so any
  // drift lands on it.
  it('corrects a multi-byte source exactly as its ASCII twin', async () => {
    const shape = (accent: string): string =>
      `class Client\n  LABEL = "${accent}${accent}"\n  attr_reader :base_url\n  def to_s\n    @base_url\n  end\nend\n`

    const wide = await format(shape('é'))
    const ascii = await format(shape('e'))

    expect(wide.replaceAll('é', 'e')).toBe(ascii)
    expect(ascii).toContain('attr_reader :base_url\n\n  def to_s')
  })

  // The only assertions here that fail if a patch is never applied: every
  // other test passes against the stock gems, which get these inputs right and
  // merely take longer to. Read off where each method was defined rather than
  // timed, because a timing threshold is a flaky test on a slow machine and a
  // silent pass on a fast one. The gems' copies live under /bundle in the
  // guest; a patch is evaluated from a string and does not.
  it('is what every cop reads through', async () => {
    const { vm } = await nodeVm.boot()

    const result = vm
      .eval(`
        [
          RuboCop::ProcessedSource.instance_method(:sorted_tokens),
          Parser::Source::Buffer.instance_method(:line_begins)
        ].map { |method| method.source_location.first.start_with?("/bundle/") }.inspect
      `)
      .toString()

    expect(result).toBe('[false, false]')
  })
})
