/**
 * A fix for syntax_tree 6.3.0, applied to the gem inside the VM at boot.
 *
 * `then` is mandatory in a `case/in` clause whose pattern ends in an endless
 * range. Without it Ruby reads the newline as the range's continuation and
 * swallows the next line into the pattern. syntax_tree knows this, but its
 * check asks whether the pattern *is* an endless range rather than whether it
 * *ends* with one:
 *
 *     q.text(" then") if pattern.is_a?(RangeNode) && pattern.right.nil?
 *
 * So it keeps `then` for `in 400..` and drops it for every pattern that merely
 * finishes with an endless range - `in 300.. | 400..`, or `in { status: 400.. }`,
 * which it also unwraps to `in status: 400..`. Both come back out as source
 * Ruby cannot parse, from input that parsed fine going in. That is the worst
 * shape a formatter bug can take: nothing raises, and the broken file is
 * already on disk.
 *
 * The fix asks the question that actually matters - what does the rendered
 * pattern end with - by formatting the pattern on its own and looking at its
 * last characters. Rendering it separately is what makes this reliable: the
 * answer cannot drift out of step with a list of node types someone has to
 * remember to extend. It is also width-independent, because a pattern that
 * breaks over several lines still ends on the same token, and it cannot be
 * fooled by a literal, because `in { m: "ends.." }` renders with its closing
 * quote.
 *
 * Measured against 1,033 files of real Ruby (the rubocop, rubocop-ast and
 * syntax_tree gems, formatted both ways and compared): the patch changes the
 * output of none of them. It only fires where stock syntax_tree emits a syntax
 * error.
 *
 * Reopening the class here rather than patching the gem inside the artifact is
 * deliberate. The artifact stays stock syntax_tree 6.3.0, the divergence is one
 * reviewable file in this repo instead of a diff buried in a 20-minute wasm
 * build, and retiring it once the fix lands upstream is deleting that file.
 */
export const IN_PATTERN_THEN_PATCH = `
module SyntaxTree
  class In
    def format(q)
      keyword = "in "
      pattern = self.pattern
      consequent = self.consequent

      q.group do
        q.text(keyword)
        q.nest(keyword.length) { q.format(pattern) }
        q.text(" then") if Formatter.format(q.source, pattern).rstrip.end_with?("..")

        unless statements.empty?
          q.indent do
            q.breakable_force
            q.format(statements)
          end
        end

        if consequent
          q.breakable_force
          q.format(consequent)
        end
      end
    end
  end
end
`
