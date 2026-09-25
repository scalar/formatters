/**
 * Correctness fixes for RuboCop 1.91.0, applied to the gem inside the VM at
 * boot.
 *
 * This is the RuboCop counterpart to `stree-patch.ts`, and it strikes the same
 * bargain: the artifact stays stock RuboCop, the divergence is one reviewable
 * file here rather than a diff buried in a wasm build, and retiring a fix once
 * upstream releases one is deleting a constant.
 *
 * `test/rubocop-conformance.test.ts` holds each fix to it: it asserts that the
 * real `rubocop` binary still gets the input wrong and that we get it right.
 * When RuboCop releases a fix, that test fails and the patch goes.
 *
 * ## A method chain inside a block that is a hash value loses its indentation
 *
 * RuboCop 1.84 taught `Layout/MultilineMethodCallIndentation` to align a chain
 * that is the value of a hash pair:
 *
 *     { key: client.foo
 *                  .bar }
 *
 * It finds that pair by walking up from the call until it meets one, stopping
 * only at parentheses. Nothing stops it at a block, so a chain that sits
 * *inside* a block which is the pair's value is taken for the value itself -
 * and with nothing on `client`'s line to align with, the cop aligns the dots
 * with `client` and every continuation line loses its indentation:
 *
 *     # syntax_tree's output, and what RuboCop 1.82 left alone
 *     run: -> do
 *       client
 *         .beta
 *         .messages
 *     end
 *
 *     # what RuboCop 1.84 through 1.91 correct it to
 *     run: -> do
 *       client
 *       .beta
 *       .messages
 *     end
 *
 * That shape is everywhere in generated code - a lambda per test case, a
 * `proc` per route, a `-> {}` per callback - and it is not just the lambda:
 * `do` blocks, braces, `begin`, `if` and the loops lead the walk out to the
 * enclosing pair the same way.
 *
 * The fix stops the walk where one of those bodies starts. A body is its own
 * run of statements, indented from its own opening line; a chain in it is not
 * the hash value, whatever pair the body happens to be nested in. Everything
 * the 1.84 change set out to do still happens - the walk passes through a
 * block's *call*, so `key: items.map do ... end.size` is still aligned as the
 * value it is - and a chain that is stopped short goes down the cop's ordinary
 * path, which is the one it took before 1.84 and which indents it again.
 *
 * Two bodies are deliberately left out. Inside a `case` branch or a `def` the
 * ordinary path has an older bug of its own - it aligns the chain with the
 * construct's first line, so `.one` lands under `case` rather than under
 * `client`, in 1.82 as in 1.91 and with no hash anywhere near - and handing
 * those to it would trade one misplaced chain for a worse one. They keep what
 * stock 1.91 does. A ternary is not a body either: its branches are
 * expressions on the pair's line, which is what the pair alignment is for.
 */

/**
 * The RuboCop the patch below was derived from.
 *
 * The retirement signal. The patch replaces one private method of one cop, and
 * a newer RuboCop could rewrite that method, rename it, or fix the bug some
 * other way - and the copy here would silently keep overriding whatever
 * upstream wrote. `rubocop-patch.test.ts` asserts the VM still reports this
 * version, so bumping the pin in `build/ruby_fmt/Gemfile` and rebuilding the
 * artifact fails there, and the patch is then re-derived from the new gem or
 * dropped because the new gem no longer needs it.
 */
export const DERIVED_FROM_RUBOCOP = '1.91.0'

/**
 * `MultilineMethodCallIndentation#find_pair_ancestor` with the walk stopped at
 * a body.
 *
 * Everything but `child` and the second `break` is stock RuboCop 1.91.0. `child` is the
 * node the walk came up from, which is what tells a block's call - still part
 * of the value - from its body, which is not.
 */
export const PAIR_ANCESTOR_PATCH = `
module RuboCop
  module Cop
    module Layout
      class MultilineMethodCallIndentation
        private

        def find_pair_ancestor(node)
          child = node
          node.each_ancestor do |ancestor|
            return ancestor if ancestor.pair_type?
            break if grouped_expression?(ancestor) || inside_arg_list_parentheses?(node, ancestor)
            break if scalar_body_of?(ancestor, child)

            child = ancestor
          end

          nil
        end

        # Whether \`child\` is part of a body \`ancestor\` opens, rather than
        # part of an expression \`ancestor\` is building. A block's call is the
        # latter; its arguments and its body are the former. \`case\` and \`def\`
        # are left to stock on purpose - see rubocop-patch.ts.
        def scalar_body_of?(ancestor, child)
          return !child.equal?(ancestor.send_node) if ancestor.any_block_type?

          ancestor.type?(:kwbegin, :while, :until, :for) || (ancestor.if_type? && !ancestor.ternary?)
        end
      end
    end
  end
end
`

/** Every correctness patch, in the order the VM should evaluate them. */
export const RUBOCOP_PATCHES = [PAIR_ANCESTOR_PATCH] as const
