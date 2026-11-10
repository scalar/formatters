# License texts and where they came from

`collect.py` writes `packages/ruby/licenses/NOTICE.md` from these texts, from
`components.json`, and from the lockfile of `build/rbcop_fmt/entry`. The
crates' own license files are read from cargo's registry checkout at build
time; everything here is a text that no build downloads, so it is committed.

`packages/ruby/licenses/cruby-LEGAL` is not generated. It is CRuby's own `LEGAL`
file, reproduced verbatim because the code it describes is compiled into
`ruby_fmt.wasm` with the rest of CRuby.

| File in `texts/` | What it is | Source |
|---|---|---|
| `canonical-MIT.txt`, `canonical-BSD-2-Clause.txt`, `canonical-Unicode-3.0.txt` | The standard texts each component's own text is compared with, and the one printed for every component that matches | The Rust toolchain's `share/doc/rust/licenses/` (SPDX's standard texts) |
| `cruby-BSDL` | CRuby's BSD-2-Clause text, the option of the two CRuby offers that this package uses | CRuby's `BSDL` |
| `logger-BSDL` | The same for the logger gem | the logger 1.7.0 gem's `BSDL` |
| `syntax_tree-LICENSE`, `prettier_print-LICENSE` | The two gems' licenses | the gems' license files |
| `ruby.wasm-LICENSE` | The license of the js gem, which ships none of its own | `ruby/ruby.wasm` `LICENSE` at tag `2.10.1` |
| `line-index-LICENSE-MIT` | The `line-index` crate, published without a license file; its manifest says `MIT OR Apache-2.0` | `rust-lang/rust-analyzer` `LICENSE-MIT` at `master` (the crate lives in its `lib/line-index`) |
| `rbs-BSDL` | The `ruby-rbs` and `ruby-rbs-sys` crates, which vendor the RBS C parser and ship no license file; their manifests say `BSD-2-Clause` | `ruby/rbs` `BSDL` at `master` |
| `rubocop-performance-LICENSE.txt` | rubocop-performance 1.27.0, whose configuration rbcop compiles in without shipping its license | the rubocop-performance 1.27.0 gem's `LICENSE.txt` |
| `unicode-display_width-MIT-LICENSE.txt`, `unicode-emoji-MIT-LICENSE.txt` | The gems rbcop's compiled-in display-width table was generated from | the gems' license files |
| `wasi-libc-LICENSE-MIT`, `wasi-libc-musl-COPYRIGHT`, `wasi-libc-cloudlibc-LICENSE`, `wasi-libc-musl-fts-COPYING` | wasi-libc, statically linked into both artifacts, and the parts of it under their own terms | `WebAssembly/wasi-libc` at tag `wasi-sdk-25`: `LICENSE-MIT`, `libc-top-half/musl/COPYRIGHT`, `libc-bottom-half/cloudlibc/LICENSE`, `fts/musl-fts/COPYING`. The first three are byte-identical at `wasi-sdk-24`, which `ruby_fmt.wasm` links; `wasi-sdk-24` has no `fts`. |
