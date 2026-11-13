---
'@scalar/ruby-fmt': minor
---

**Breaking.** `@scalar/ruby-fmt` is now `rubocop --autocorrect --only Layout` and nothing else, byte-identical to RuboCop 1.92.2. The reprinting pass that ran before it, on a CRuby VM compiled to wasm, is gone, and with it the `ruby_fmt.wasm.br` artifact and the `@ruby/wasm-wasi` dependency.

What the formatter does now: it corrects Layout - indentation, alignment, blank lines, spacing and line length - within the line structure it is given. What it no longer does: reprint. It does not move statements onto lines of their own, so `def x; a; b; end` comes out as it went in. It suits input that already has its line structure, such as generated code, and output changes for any input whose line breaking the reprinter used to change.

- **`printWidth` is now `Layout/LineLength`'s `Max`, and defaults to 120** (it was 80). 120 is RuboCop's own default, so with no options the output is exactly what stock RuboCop writes; 80 was the old reprinter's width and now would only make the cop rebreak more of the line structure the caller chose. The cop's autocorrect only breaks at argument lists, collection literals and block braces, so a long string literal or constant assignment stays long, and a broken line can still be over the limit. A `Layout/LineLength` entry in `rubocopConfig` wins over `printWidth`.
- **`rubocop: false` throws a `TypeError`** instead of meaning "reprint only". There is nothing left to run without RuboCop.
- **Unparseable input rejects with Prism's message and the line**, rather than being reported as a bug in the pass.
- **Where RuboCop gives up, so does the package.** An rbcop bug let a guard clause followed by a statement on the same line (`break if a; b = 1`) through inside `begin … end`, where RuboCop flags it and then reports an infinite loop; the package now rejects such a file the same way.
- **`formatSync` needs no `init()` under Node**, and never refuses for memory: the module is read, decompressed, compiled and instantiated synchronously, and recovering from a crash in the pass is synchronous too. `init` stays, and is optional under Node. In a browser, `formatSync` still needs one `await init()`.
- **The browser build's `init` takes `{ url, bytes, encoding }` for `rbcop_fmt.wasm.br`**, at the top level. `init({ rbcop: { … } })` throws, and a top-level `url` no longer means the removed artifact.
- **`@scalar/ruby-fmt/wasm` resolves to `rbcop_fmt.wasm.br`.** `@scalar/ruby-fmt/rbcop-wasm` still does too.
- **Cost:** measured over 300 files of real Ruby, the first call drops from ~0.44 s to ~0.21 s, a file from 17.5 ms to 2.5 ms at the median, and peak memory from ~600 MB to 160 MB; the installed size drops from 9.1 MB to 2.7 MB.

rbcop now builds from upstream (costajohnt/rbcop), at the merge that carries the `case/in` guard fix the build previously took from a fork. That switch on its own changes no code: built from either, the artifact is byte for byte the same.
