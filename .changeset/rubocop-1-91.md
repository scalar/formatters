---
"@scalar/ruby-fmt": minor
---

The bundled RuboCop moves from 1.81.6 to 1.91.0. rubocop-ast stays at 1.50.0 and parser at 3.3.12.0, so both boot-time performance patches still apply to the versions they were written against. Among RuboCop's own dependencies, parallel moves to 2.2.0, regexp_parser to 2.13.0, unicode-display_width to 3.3.0 and unicode-emoji to 4.3.0. `@ruby/wasm-wasi` moves from 2.8.1 to 2.10.1, which matches the `js` gem 2.10.1 already built into the artifact.

**This changes output**, in the Layout corrections RuboCop makes after syntax_tree. Formatting 304 files taken from the parser, rubocop-ast, syntax_tree, regexp_parser, rainbow and unicode-display_width gems, 6 come back different. Each difference is RuboCop 1.91's indentation for one of three things: a method chain wrapped onto the lines after its receiver, a block hanging off such a chain, or a parenthesised multi-line `if` condition. `test/rubocop-conformance.test.ts` asserts byte-identical output against a native `rubocop` 1.91.0, and passes. A consumer comparing against their own `rubocop --only Layout` in CI should move to 1.91.0 too.

The artifact grows from 12.7 MB to 13.2 MB.
