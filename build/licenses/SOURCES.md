# License texts and where they came from

`collect.py` writes `packages/ruby/licenses/NOTICE.md` from these texts, from
`components.json`, and from the lockfile of `build/rbcop_fmt/entry`. The
crates' own license files are read from cargo's registry checkout at build
time; everything here is a text that no build downloads, so it is committed.

| File in `texts/` | What it is | Source |
|---|---|---|
| `canonical-MIT.txt`, `canonical-BSD-2-Clause.txt`, `canonical-Unicode-3.0.txt` | The standard texts each component's own text is compared with, and the one printed for every component that matches | The Rust toolchain's `share/doc/rust/licenses/` (SPDX's standard texts) |
| `line-index-LICENSE-MIT` | The `line-index` crate, published without a license file; its manifest says `MIT OR Apache-2.0` | `rust-lang/rust-analyzer` `LICENSE-MIT` at `master` (the crate lives in its `lib/line-index`) |
| `rbs-BSDL` | The `ruby-rbs` and `ruby-rbs-sys` crates, which vendor the RBS C parser and ship no license file; their manifests say `BSD-2-Clause` | `ruby/rbs` `BSDL` at `master` |
| `rubocop-performance-LICENSE.txt` | rubocop-performance 1.27.0, whose configuration rbcop compiles in without shipping its license | the rubocop-performance 1.27.0 gem's `LICENSE.txt` |
| `unicode-display_width-MIT-LICENSE.txt`, `unicode-emoji-MIT-LICENSE.txt` | The gems rbcop's compiled-in display-width table was generated from | the gems' license files |
| `wasi-libc-LICENSE-MIT`, `wasi-libc-musl-COPYRIGHT`, `wasi-libc-cloudlibc-LICENSE`, `wasi-libc-musl-fts-COPYING` | wasi-libc, statically linked into the artifact, and the parts of it under their own terms | `WebAssembly/wasi-libc` at tag `wasi-sdk-25`: `LICENSE-MIT`, `libc-top-half/musl/COPYRIGHT`, `libc-bottom-half/cloudlibc/LICENSE`, `fts/musl-fts/COPYING`. |
