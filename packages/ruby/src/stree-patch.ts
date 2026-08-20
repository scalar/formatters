/**
 * Correctness fixes for syntax_tree 6.3.0, applied to the gem inside the VM at
 * boot.
 *
 * Every patch here is the same shape of bug: syntax_tree reads Ruby that parses
 * and writes back Ruby that does not - or, worse, Ruby that parses as something
 * else. `format.ts` re-parses the result and throws rather than handing a
 * consumer a broken file, so what a consumer of this package sees today is a
 * formatter that refuses whole files. These are what the guard is refusing.
 *
 * The divergence is deliberately narrow, and measured: formatting the rubocop
 * (1.74 and 1.81), rubocop-ast, syntax_tree, parser and regexp_parser gems both
 * ways - 2,076 files - these change the output of none of them, and leave none
 * of them failing to format. They fire only where stock syntax_tree is already
 * emitting a syntax error.
 *
 * Reopening the classes here rather than patching the gem inside the artifact is
 * deliberate. The artifact stays stock syntax_tree 6.3.0, the divergence is one
 * reviewable file in this repo instead of a diff buried in a 20-minute wasm
 * build, and retiring one once the fix lands upstream is deleting a constant.
 *
 * `test/native-conformance.test.ts` holds each of these to the same bargain: it
 * asserts that native `stree` still gets the input wrong and that we get it
 * right. When syntax_tree releases the fix, that test fails and the patch goes.
 */

/**
 * `then` and parentheses in a `case/in` clause whose pattern ends in an endless
 * range.
 *
 * Ruby needs something after a trailing `400..`, or it reads the newline as the
 * range's continuation and swallows the next line into the pattern. syntax_tree
 * knows this, but its check asks whether the pattern *is* an endless range
 * rather than whether it *ends* with one:
 *
 *     q.text(" then") if pattern.is_a?(RangeNode) && pattern.right.nil?
 *
 * So it keeps `then` for `in 400..` and drops it for every pattern that merely
 * finishes with an endless range - `in 300.. | 400..`, or `in { status: 400.. }`,
 * which it also unwraps to `in status: 400..`. Both come back out as source
 * Ruby cannot parse, from input that parsed fine going in.
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
 * ## Guarded clauses need parentheses, not `then`
 *
 * `in (400..) if g` cannot be fixed the same way, because the guard already
 * occupies the place `then` would go - `in 400.. then if g` is not Ruby. The
 * parentheses the author wrote are the only legal spelling, and syntax_tree
 * drops them: its parser does not record them at all (the clause arrives as an
 * `IfNode` wrapping the pattern), so the output is `in 400 ..  if g`, which
 * Ruby rejects with `unexpected 'if', expecting 'then'`. Writing `then`
 * defensively in the input does not help, because that `then` is not in the
 * tree either.
 *
 * So a guarded clause whose pattern does not terminate itself gets the pattern
 * wrapped back in a `Paren` node before it is formatted. Going through a real
 * node rather than printing "(" and ")" is what makes it come out right in the
 * cases where parentheses alone would not: a `Paren` parent also makes
 * `HshPtn` print its braces (see {@link HSH_PTN_THEN_PATCH}), so
 * `in {x: (500..)} if g` comes back as `in ({ x: 500.. }) if g` rather than the
 * unparseable `in (x: 500..) if g`.
 *
 * Two spellings count as "does not terminate itself", and both are read off the
 * rendered pattern for the same reason as above: a trailing `..`, and a
 * trailing `then` - which is what a bare `**` hash pattern renders as, and
 * which a guard would land after just as illegally.
 */
export const IN_PATTERN_THEN_PATCH = `
module SyntaxTree
  class In
    # The two shapes a guard arrives in. Nothing else can be an \`in\` pattern
    # and an If/Unless at the same time, so this doubles as the test for one.
    GUARD_NODES = [IfNode, UnlessNode].freeze

    def format(q)
      keyword = "in "
      pattern = self.pattern
      consequent = self.consequent

      guard = GUARD_NODES.include?(pattern.class) ? pattern : nil
      subject = guard ? guard.statements.body[0] : pattern

      # Formatted on its own, so that the question is what the pattern ends
      # with rather than which node types someone remembered to list.
      rendered = subject ? Formatter.format(q.source, subject).rstrip : ""
      dangling = rendered.end_with?("..", "then")

      if guard && dangling
        pattern =
          guard.copy(
            statements:
              Statements.new(
                body: [
                  Paren.new(
                    lparen: LParen.new(value: "(", location: subject.location),
                    contents: subject,
                    location: subject.location
                  )
                ],
                location: guard.statements.location
              )
          )
      end

      q.group do
        q.text(keyword)
        q.nest(keyword.length) { q.format(pattern) }

        # Only the endless range needs \`then\`; a bare \`**\` pattern prints its
        # own, and a guarded clause got parentheses instead just above.
        q.text(" then") if guard.nil? && rendered.end_with?("..")

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

/**
 * Where the ` then` after a bare `**` hash pattern is printed.
 *
 * A hash pattern ending in a nameless `**` needs `then` for the same reason an
 * endless range does: without it, `in a: 1, **` reads the next line's first
 * identifier as the double splat's name, so `x` on the following line becomes
 * `**x` and the clause body silently empties. syntax_tree adds the `then`, but
 * it adds it in `format_contents`, which runs *inside* the `q.text("{") …
 * q.text("}")` group:
 *
 *     in { a: 1, ** then }   # syntax error, unexpected 'then', expecting '}'
 *
 * The braces already do the job the `then` was there for, so the fix is not to
 * move it outside them - it is to print it only in the one rendering that has
 * no braces, which is the single-part unwrapped form (`in ** then`). That also
 * keeps the output clear of a keyword RuboCop's `Style/MultilineInPatternThen`
 * would want to take back out.
 *
 * The `nested` test grows a second case at the same time: a `Paren` parent
 * forces braces too. `in (x: 500..)` is not legal Ruby, so a hash pattern
 * inside parentheses has to print them - which is what lets
 * {@link IN_PATTERN_THEN_PATCH} fix a guarded hash pattern by wrapping it.
 */
export const HSH_PTN_THEN_PATCH = `
module SyntaxTree
  class HshPtn
    def format(q)
      parts = keywords.map { |(key, value)| KeywordFormatter.new(key, value) }
      parts << KeywordRestFormatter.new(keyword_rest) if keyword_rest

      # A Paren parent counts as nesting because \`in (x: 1)\` does not parse -
      # inside parentheses the braces are what make the pattern legal.
      nested = PATTERNS.include?(q.parent.class) || q.parent.is_a?(Paren)

      # If there is a constant, we're going to format to have the constant name
      # first and then use brackets.
      if constant
        q.group do
          q.format(constant)
          q.text("[")
          q.indent do
            q.breakable_empty
            format_contents(q, parts)
          end
          q.breakable_empty
          q.text("]")
        end
        return
      end

      # If there's nothing at all, then we're going to use empty braces.
      if parts.empty?
        q.text("{}")
        return
      end

      # If there's only one pair, then we'll just print the contents provided
      # we're not inside another pattern.
      if !nested && parts.size == 1
        format_contents(q, parts)

        # The one rendering with nothing after the \`**\` to stop the next line
        # being read as its name. Every other one closes with a brace or a
        # bracket, which does the same job.
        q.text(" then") if keyword_rest && keyword_rest.value.nil?
        return
      end

      # Otherwise, we're going to always use braces to make it clear it's a hash
      # pattern.
      q.group do
        q.text("{")
        q.indent do
          q.breakable_space
          format_contents(q, parts)
        end

        if q.target_ruby_version < Formatter::SemanticVersion.new("2.7.3")
          q.text(" }")
        else
          q.breakable_space
          q.text("}")
        end
      end
    end

    private

    def format_contents(q, parts)
      q.group { q.seplist(parts) { |part| q.format(part, stackable: false) } }
    end
  end
end
`

/**
 * Which `**` a hash pattern is allowed to claim as its own.
 *
 * Ripper does not report a nameless `**` at the end of a hash pattern, so
 * syntax_tree recovers it from the token stream - and recovers it with an
 * unbounded reverse search:
 *
 *     def find_operator(name)
 *       index = tokens.rindex { |token| token.is_a?(Op) && (token.name == name) }
 *       tokens[index] if index
 *     end
 *
 * Nothing in that asks whether the token it found is anywhere near the pattern.
 * An exponent `**` is an `Op` named `:**` that no other rule consumes, so a
 * `retry_count**2` on line 350 is still sitting in the list when line 510 is
 * parsed, and the hash pattern there adopts it. The node locations say so
 * outright: an `HshPtn` spanning `510:13..510:34` with a `keyword_rest` at
 * `350:29..350:31`.
 *
 * What comes out is a pattern with a `**` that was never written, which is
 * unparseable in the common case (`in { a: 1, b: 2, ** then }`) and quietly
 * wrong in the rest: `in {}` matches only an empty hash, and `in **` matches
 * any hash at all. Spacing the exponent as `n ** 2` avoids it, but syntax_tree
 * normalises that straight back to `n**2`, so it returns on the next run.
 *
 * The fix gives the search a floor. A `**` that belongs to this pattern is
 * always the last thing in it, so it has to start after everything else the
 * pattern is known to contain - its constant, its keywords, and its opening
 * brace. Anything earlier is somebody else's operator and is left in the token
 * list. That covers the pin expression too, where the stray `**` is *inside*
 * the pattern rather than before it: `in { a: ^(n**2), b: 2 }` puts it before
 * the last keyword ends, so it is refused for the same reason.
 *
 * The braces move above the search because they are one of those bounds. They
 * are only looked up here, not removed - the deletions stay where they were.
 */
export const HSH_PTN_DOUBLE_SPLAT_PATCH = `
module SyntaxTree
  class Parser
    def on_hshptn(constant, keywords, keyword_rest)
      keywords =
        (keywords || []).map do |(label, value)|
          if label.is_a?(Label)
            [label, value]
          else
            tstring_beg_index =
              tokens.rindex do |token|
                token.is_a?(TStringBeg) &&
                  token.location.start_char < label.location.start_char
              end

            tstring_beg = tokens.delete_at(tstring_beg_index)

            label_end_index =
              tokens.rindex do |token|
                token.is_a?(LabelEnd) &&
                  token.location.start_char == label.location.end_char
              end

            label_end = tokens.delete_at(label_end_index)

            [
              DynaSymbol.new(
                parts: label.parts,
                quote: label_end.value[0],
                location: tstring_beg.location.to(label_end.location)
              ),
              value
            ]
          end
        end

      # Found before the ** search rather than after it, because the opening
      # brace is one of the bounds that search is checked against. Still only
      # deleted below, where they always were.
      lbrace = rbrace = nil
      unless constant
        lbrace = find_token(LBrace)
        rbrace = find_token(RBrace)
      end

      if keyword_rest
        # We're doing this to delete the token from the list so that it doesn't
        # confuse future patterns by thinking they have an extra ** on the end.
        consume_operator(:**)
      elsif (token = find_pattern_double_splat(constant, keywords, lbrace))
        tokens.delete(token)

        # Create an artificial VarField if we find an extra ** on the end. This
        # means the formatting will be a little more consistent.
        keyword_rest = VarField.new(value: nil, location: token.location)
      end

      parts = [constant, *keywords.flatten(1), keyword_rest].compact

      if lbrace && rbrace
        parts = [lbrace, *parts, rbrace]
        tokens.delete(lbrace)
        tokens.delete(rbrace)
      end

      HshPtn.new(
        constant: constant,
        keywords: keywords,
        keyword_rest: keyword_rest,
        location: parts[0].location.to(parts[-1].location)
      )
    end

    private

    # The trailing ** of this pattern, or nil when the only ** left in the token
    # list belongs to something else - an exponent earlier in the file, or a pin
    # expression inside this very pattern.
    def find_pattern_double_splat(constant, keywords, lbrace)
      token = find_operator(:**)
      return nil unless token

      floor =
        [
          constant&.location&.end_char,
          lbrace&.location&.end_char,
          *keywords.flatten(1).compact.map { |node| node.location.end_char }
        ].compact.max

      return nil if floor && token.location.start_char < floor
      token
    end
  end
end
`

/**
 * Every patch, in the order the VM should evaluate them.
 *
 * The parser patch goes last only for readability - each one reopens a
 * different class, so nothing here depends on the order.
 */
export const STREE_PATCHES = [IN_PATTERN_THEN_PATCH, HSH_PTN_THEN_PATCH, HSH_PTN_DOUBLE_SPLAT_PATCH] as const
