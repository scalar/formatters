---
"@scalar/ruby-fmt": minor
---

The RuboCop Layout pass now runs as rbcop, RuboCop 1.92.2 reimplemented in Rust and compiled to a second wasm module, instead of the RuboCop gem inside the Ruby VM. A full format is about 4x faster (the pass itself about 20x), the installed artifacts shrink from 13.9 MB to 7.9 MB, the Ruby VM no longer grows with every file, and `{ rubocop: false }` no longer loads the pass at all.

What changes for consumers:

- Output follows RuboCop 1.92.2 rather than 1.91.0. A method chain inside a block that is a hash value keeps its indent as before, now because 1.92.2 fixed the bug this package used to patch.
- `rubocopConfig` cannot use features that need Ruby (ERB, remote `inherit_from`, `require:`, custom cops); each is now an error naming what was asked for.
- The browser build loads a second artifact, `rbcop_fmt.wasm.br`, beside `ruby_fmt.wasm.br`. `init({ rbcop: { url, bytes, encoding } })` points at it; `init({ url })` still means the syntax_tree artifact. It is also exported as `@scalar/ruby-fmt/rbcop-wasm`.
- The RuboCop pass is now exact by test rather than by construction: a conformance test holds it byte-identical to the real `rubocop` 1.92.2.
