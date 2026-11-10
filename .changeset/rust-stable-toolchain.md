---
"@scalar/rust-fmt": minor
---

The bundled rustfmt moves from 1.12.0-nightly (`nightly-2026-11-10`, rust-lang/rust `ac8310ba6`) to the rustfmt that ships with stable Rust 1.99.1: rustfmt 1.10.0 (`58cf8f9c3`), built as the stable channel. The package now matches `cargo fmt` on stable 1.99.1 instead of a dated nightly, so a consumer comparing against a native `rustfmt` in CI can use their normal stable toolchain. **This can change output**, because it is an older rustfmt than the previous release. `test/native-conformance.test.ts` asserts byte-identical output against `rustfmt 1.10.0-stable (58cf8f9c35 2026-10-13)` and passes, and so does every one of the 767 files under rustfmt's own `tests/source`.

**Breaking:** the typed options for settings rustfmt marks unstable are removed from `FormatOptions`. They are `wrapComments`, `formatCodeInDocComments`, `formatStrings`, `importsGranularity`, `whereSingleLine` and `normalizeDocAttributes`. They can still be set by their rustfmt names through `config` (`{ config: { imports_granularity: 'Crate' } }`), which applies them the way `rustfmt --config` does on stable. Stable rustfmt ignores these keys when it reads them from a `rustfmt.toml`, so remove them from a parsed `rustfmt.toml` before passing it in if you want to match `cargo fmt`.
