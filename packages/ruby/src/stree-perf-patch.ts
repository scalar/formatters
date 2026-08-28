/**
 * Performance fixes for syntax_tree 6.3.0, applied to the gem inside the VM at
 * boot.
 *
 * Separate from `stree-patch.ts` because the bargain is a different one. Those
 * patches change what the gem *writes* - each one fixes an input stock
 * syntax_tree turns into Ruby that will not parse - and `native-conformance`
 * holds them honest by asserting the gem still gets those inputs wrong. This
 * file changes only what the gem *costs*. Native syntax_tree gets these inputs
 * right; it just takes quadratic time over them, and the bytes it returns are
 * the bytes we return. So the guard here is the opposite one: the same
 * conformance test asserts we still match the gem byte for byte, on sources
 * shaped to run through the code below.
 *
 * ## The bug
 *
 * `SyntaxTree::Parser#on_comment` decides whether a comment is inline (`x = 1 #
 * why`) or stands on its own by walking backwards from the `#` over spaces and
 * tabs, one character at a time, indexing into the source string by *character*
 * offset:
 *
 *     index = char - 1
 *     while index > -1 && (source[index] == "\t" || source[index] == " ")
 *       index -= 1
 *     end
 *
 * `String#[]` is O(1) only while CRuby can treat the string as one byte per
 * character. A source holding a single multi-byte character anywhere - one
 * accented letter in one comment is enough - makes every one of those indexes
 * walk the string from the beginning to count characters, so the walk costs
 * O(file size) per step and the parse becomes quadratic in it.
 *
 * Nothing about that is exotic in generated code, where a doc comment sits
 * above nearly every line and each one is indented. Take a 317KB generated Ruby
 * file carrying four accented characters. Under a profiler that counts them,
 * `on_comment` makes 104,172 of those indexes and they account for 5.4s of a
 * 7.3s parse. The control settles what they cost: the same file with its four
 * characters replaced by ASCII ones - identical in characters and in shape -
 * parses in 377ms against 6.1s.
 *
 * Those are `SyntaxTree.parse` timed on its own inside the VM. The end-to-end
 * figures below are `format` calls, each warmed once first. Read within a pair,
 * not across the two - a parse is part of a format, but these came off
 * different harnesses and different VM states, and the VM is stateful enough
 * that the numbers do not nest.
 *
 * ## The fix
 *
 * Scan a copy of the source with every character that is not a space, a tab or
 * a newline replaced by `x`. The loop asks three questions of a character - is
 * it a tab, is it a space, is it a newline - and the copy answers all three the
 * same way the source does; it has the same number of characters, so an index
 * means the same thing in both; and being pure ASCII it indexes in constant
 * time. It is built once per parse, and not at all for a source that is already
 * ASCII.
 *
 * End to end, with the RuboCop pass off: that 317KB file formats in 0.7s
 * instead of 5.8s, and the 568KB file from the same tree in 2.7s instead of
 * 17.4s. What that removes is the dominant quadratic term, not every one -
 * formatting a large file is still superlinear in its size after this, and
 * still slower with a multi-byte character in it than without.
 *
 * The patch is deliberately confined to `on_comment`. The parser indexes
 * `source` in a handful of other places, and every one of them is O(file size)
 * on a multi-byte source for the same reason - but they are reached per node
 * rather than per indented character. Over the file above they come to 178ms of
 * the 1.3s that parse now takes under the same profiler, against `on_comment`'s
 * 5.4s before this. One file is thin evidence for a general claim, but it is
 * two orders of magnitude of headroom, and nothing else here is worth diverging
 * from the gem for on less.
 */

/**
 * How `on_comment` tells an inline comment from a standalone one.
 *
 * The body is stock syntax_tree 6.3.0's, with its three reads of `source`
 * pointed at the string `whitespace_scan_source` returns and its comments
 * shortened - the long ones are re-told above rather than repeated here.
 * Comment classification is unchanged by construction: the replacement
 * preserves every space, tab and newline, and the loop asks about nothing else.
 * Every other character stops the backward walk in both, and is not a newline
 * in either, so `inline` comes out the same.
 *
 * `rindex` and a regular expression are still avoided inside the loop, for the
 * reason the gem gives where it wrote it: both refuse a string carrying invalid
 * bytes, which `__END__` makes possible. That is also why the scan source falls
 * back to the source itself when the encoding is invalid - `tr` refuses such a
 * string too, so a file that only stock syntax_tree could read keeps being read
 * the way stock syntax_tree reads it, at stock syntax_tree's cost.
 */
export const ON_COMMENT_SCAN_PATCH = `
module SyntaxTree
  class Parser
    # Private because every Ripper handler in the gem is - reopening the class
    # resets the default visibility, so saying nothing here would quietly widen
    # one. Ripper dispatches its events regardless of visibility.
    private

    def on_comment(value)
      # char is the index of the # character in the source.
      char = char_pos
      location =
        Location.token(
          line: lineno,
          char: char,
          column: current_column,
          size: value.size - 1
        )

      # Loop backward from the beginning of the comment and find the first
      # character that is not a space or a tab. If index is -1, this comment is
      # at the very beginning of the file.
      scan = whitespace_scan_source
      index = char - 1
      while index > -1 && (scan[index] == "\\t" || scan[index] == " ")
        index -= 1
      end

      # If the character before the comment is neither whitespace nor a
      # newline, the comment is inline. Otherwise it stands on its own and can
      # be attached as its own node in the tree.
      inline = index != -1 && scan[index] != "\\n"
      comment =
        Comment.new(value: value.chomp, inline: inline, location: location)

      @comments << comment
      comment
    end

    # A stand-in for the source that indexes by character offset in O(1), which
    # CRuby manages only on a string it can treat as one byte per character.
    #
    # Built once per parse and only when it would help. An ASCII source is
    # already such a string; a source whose encoding is invalid is handed back
    # untouched because tr refuses one, which is the fallback the constant's
    # documentation explains. ASCII is not the only encoding that would index in
    # constant time - a single-byte one such as ISO-8859-1 does too, and builds
    # a copy here for nothing - but Ruby exposes no predicate for that, and
    # those encodings do not reach this package.
    #
    # The copy costs one more source-sized string, live for as long as the parse
    # is. That is far below the granularity of the VM's linear-memory leak,
    # which format.ts recycles at 400MB after roughly every 140KB of input.
    def whitespace_scan_source
      @whitespace_scan_source ||=
        if source.ascii_only? || !source.valid_encoding?
          source
        else
          source.tr("^ \\t\\n", "x")
        end
    end
  end
end
`

/** Every performance patch, in the order the VM should evaluate them. */
export const STREE_PERF_PATCHES = [ON_COMMENT_SCAN_PATCH] as const
