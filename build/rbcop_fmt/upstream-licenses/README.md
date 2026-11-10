# Upstream license texts

License texts for things linked into one of `@scalar/ruby-fmt`'s artifacts
that do not carry their own in what the builds download. Each was fetched once
from the source named here and is committed so the builds stay offline-safe.
`collect-licenses.py` (for `rbcop_fmt.wasm`) and `packages/ruby/licenses/`
(for `ruby_fmt.wasm`) use them.

| File | What it covers | Source |
|---|---|---|
| `line-index-LICENSE-MIT`, `line-index-LICENSE-APACHE` | the `line-index` crate, published without a license file; its manifest says `MIT OR Apache-2.0` | `rust-lang/rust-analyzer`, `LICENSE-MIT` and `LICENSE-APACHE` at `master` (the crate lives in that repository's `lib/line-index`) |
| `rbs-BSDL`, `rbs-COPYING` | the `ruby-rbs` and `ruby-rbs-sys` crates, which vendor the RBS C parser and ship no license file; their manifests say `BSD-2-Clause` | `ruby/rbs`, `BSDL` and `COPYING` at `master` |
| `rubocop-performance-LICENSE.txt` | rubocop-performance 1.27.0's `config/default.yml`, which rbcop compiles in as `config/plugins/rubocop-performance.yml` without shipping its license | the rubocop-performance 1.27.0 gem's `LICENSE.txt` |
| `unicode-display_width-MIT-LICENSE.txt`, `unicode-emoji-MIT-LICENSE.txt` | the display-width table rbcop generated from unicode-display_width 3.3.0 (which takes its emoji data from unicode-emoji 4.3.0) and compiles in as `src/helpers/alignment.rs` | the two gems' license files; these used to ship in `packages/ruby/licenses/` when both gems were inside `ruby_fmt.wasm` as RuboCop dependencies |
| `wasi-sdk-25-*`, `musl-COPYRIGHT` | wasi-libc from wasi-sdk 25, statically linked into `rbcop_fmt.wasm` | `WebAssembly/wasi-libc` at tag `wasi-sdk-25`: `LICENSE`, `LICENSE-MIT`, `LICENSE-APACHE`, `LICENSE-APACHE-LLVM`, `libc-bottom-half/cloudlibc/LICENSE`, `fts/musl-fts/COPYING`, `libc-top-half/musl/COPYRIGHT` |
| `wasi-sdk-24-*` | wasi-libc from wasi-sdk 24, statically linked into `ruby_fmt.wasm` | `WebAssembly/wasi-libc` at tag `wasi-sdk-24`, the same files (24 has no `fts`; its `musl/COPYRIGHT` is byte-identical to 25's) |
