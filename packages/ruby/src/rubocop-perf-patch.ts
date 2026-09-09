/**
 * Performance fixes for the gems the RuboCop pass runs on - rubocop-ast 1.50.0
 * and parser 3.3.12.0 - applied inside the VM at boot.
 *
 * The bargain is the one `stree-perf-patch.ts` strikes, not the one
 * `stree-patch.ts` does: nothing here changes a byte of output. RuboCop gets
 * these inputs right; it just spends longer on them than it needs to, and the
 * bytes it returns are the bytes we return. The guards are the same as for the
 * syntax_tree copy - `rubocop-perf-patch.test.ts` asserts each replacement
 * answers exactly as the gem's own expression does, on sources shaped to reach
 * it, and `test/rubocop-conformance.test.ts` runs one of those shapes per patch
 * through the real `rubocop` binary and asserts byte-identical output.
 *
 * ## 1. The token sort, on every file with a heredoc in it
 *
 * Every Layout cop that works from tokens rather than from the tree asks
 * `ProcessedSource#sorted_tokens` for them, and the first one to ask pays for
 * the sort. Most of the time there is nothing to sort: the token list arrives
 * in position order and a linear check hands it straight back. A heredoc breaks
 * that. Its body is lexed where it sits in the file, but the tokens for the
 * rest of the line that opened it come first, so any file with a heredoc in it
 * - every one, not just a heredoc passed as an argument - takes the other
 * branch, and that branch is a stable sort keyed on a two-element array:
 *
 *     tokens.sort_by.with_index { |token, i| [token.begin_pos, i] }
 *
 * `sort_by` compares keys with `<=>`, and on Integers it does that inline. On
 * Arrays it cannot: every comparison is a method call into `Array#<=>`, which
 * compares the two positions through another, and only then the two indexes.
 * For one 49 KB file of real Ruby with 4,738 tokens, measured inside the VM
 * under Node: the gem's sort takes ~150 ms, and the linear check that decides
 * whether to run it takes under 1 ms. Over a 545 KB corpus of 60 files it
 * added up to 16.5% of everything the formatter did, because RuboCop parses
 * once per correction round and sorts once per parse.
 *
 * The fix folds the pair into one Integer. With `count` tokens, the key
 * `begin_pos * count + index` orders by position first and, among equal
 * positions, by index - which is exactly what the pair does, since `index` is
 * always below `count`. The keys are distinct, so the sort has no ties to be
 * stable about; the comparisons are Integer against Integer, which is the case
 * `sort_by` optimises; and the tokens come out in the same order. Ruby's
 * Integers are arbitrary precision, so there is no file size at which the
 * product misbehaves - a large one merely turns fixnum comparisons into bignum
 * ones. The same file sorts in ~9 ms.
 *
 * ## 2. The line table, on every file with a multi-byte character in it
 *
 * The same bug the syntax_tree patch fixes, one layer down. Every `.line` and
 * `.column` a cop asks of a node, a token or a comment goes through
 * `Parser::Source::Buffer#line_begins`, the table of character offsets at
 * which each line starts. The gem builds it once per buffer by walking the
 * source with `String#index("\n", from)`, and `index` with a starting offset
 * is constant time only while CRuby can treat the string as one byte per
 * character. One accented letter anywhere in the file makes each of those
 * calls count characters from the start, so the table costs O(size x lines)
 * to build - and RuboCop builds it again on every correction round, because
 * each round parses the corrected source into a new buffer.
 *
 * On one 589 KB file of real Ruby with 17,401 lines and 729 of them carrying
 * a multi-byte character, measured inside the VM under Node, the table took
 * 9.0 s to build. That file goes round the correction loop four times, so it
 * paid for it four times, which was most of the 51 s the file took to format.
 *
 * The fix walks the source once with `each_line`, adding each line's character
 * length to a running position: linear whatever the encoding, and the same
 * table, entry for entry, including the sentinel the gem appends. An ASCII
 * source keeps the gem's own loop, which is already linear there and cheaper
 * than allocating a string per line. So does a source whose encoding is
 * invalid, for the reason the syntax_tree patch gives - what stock could read,
 * it goes on reading the way stock reads it - though `Buffer#source=` raises on
 * one before `line_begins` could see it, so that branch is belt and braces.
 * The same table builds in ~25 ms.
 */

/**
 * The rubocop-ast whose `sorted_tokens` the first patch was derived from.
 *
 * The retirement signal, for the reason `stree-perf-patch.ts` gives for its
 * own: each patch here replaces a whole method with a copy that produces
 * identical output, so an upstream rewrite - including one that makes this very
 * change - would be silently overridden and nothing would say so.
 * `rubocop-perf-patch.test.ts` asserts the VM still reports this version, read
 * out of the running artifact rather than off disk. Bumping the pin in
 * `build/ruby_fmt/Gemfile` and rebuilding the artifact fails that test, and the
 * copy is then re-derived from the new gem or dropped because the new gem no
 * longer needs it.
 */
export const DERIVED_FROM_RUBOCOP_AST = '1.50.0'

/**
 * The parser whose `line_begins` the second patch was derived from, guarded the
 * same way. It arrives as a dependency rather than a Gemfile pin, so the
 * version to compare against is the one `build/ruby_fmt/Gemfile.lock` resolved.
 */
export const DERIVED_FROM_PARSER = '3.3.12.0'

/**
 * `ProcessedSource#sorted_tokens` with the sort keyed on one Integer per token
 * instead of an Array.
 *
 * Everything but the key is stock rubocop-ast 1.50.0: `tokens_sorted?` still
 * decides whether anything needs sorting, and `@sorted_tokens` still memoises
 * the answer. `RuboCop::ProcessedSource` is the gem's own alias for this class,
 * so reopening it here reaches the one every cop reads through.
 */
export const SORTED_TOKENS_PATCH = `
module RuboCop
  module AST
    class ProcessedSource
      # The tokens list is always sorted by token position, except for cases when heredoc
      # is passed as a method argument. In this case tokens are interleaved by
      # heredoc contents' tokens.
      def sorted_tokens
        # Most sources have their tokens already in order, in which case
        # sorting can be skipped entirely. Callers only ever read from the
        # returned array, so it is safe to reuse \`tokens\` as is.
        @sorted_tokens ||= if tokens_sorted?
                             tokens
                           else
                             # A stable sort by position, with the (position,
                             # index) pair folded into one Integer so that every
                             # comparison is Integer <=> Integer rather than a
                             # call into Array#<=>. index < count, so the
                             # product orders by position first and by index
                             # among equals - the pair's order, key for key.
                             count = tokens.size
                             index = -1
                             tokens.sort_by { |token| (token.begin_pos * count) + (index += 1) }
                           end
      end
    end
  end
end
`

/**
 * `Parser::Source::Buffer#line_begins` built by one pass over the lines when
 * the source is not ASCII.
 *
 * The ASCII branch is stock parser 3.3.12.0, loop for loop, and the sentinel
 * after both branches is the gem's. `each_line` splits after every newline and
 * hands the tail back whether or not one ends it, so the position after a line
 * is recorded only when the line ends in a newline - which is when, and only
 * when, the gem's loop would have found one.
 */
export const LINE_BEGINS_PATCH = `
module Parser
  module Source
    class Buffer
      def line_begins
        @line_begins ||= begin
          begins = [0]

          if @source.ascii_only? || !@source.valid_encoding?
            index = 0
            while index = @source.index("\\n".freeze, index)
              index += 1
              begins << index
            end
          else
            # String#index with an offset counts characters from the start of
            # a multi-byte string on every call, which makes the loop above
            # quadratic in the source. One walk over the lines is not.
            position = 0
            @source.each_line do |line|
              position += line.length
              begins << position if line.end_with?("\\n")
            end
          end

          begins << @source.size + 1
          begins
        end
      end
    end
  end
end
`

/** Every performance patch, in the order the VM should evaluate them. */
export const RUBOCOP_PERF_PATCHES = [SORTED_TOKENS_PATCH, LINE_BEGINS_PATCH] as const
