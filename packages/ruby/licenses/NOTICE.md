# Third-party notices

This package ships two compiled artifacts, and each **embeds** the software
below. The sources are no longer visible in this tree - they are inside the
binaries - so their licenses are reproduced here, as those licenses require.

Everything in both is permissive. Nothing is copyleft, and there are no known
gaps: every component linked into either artifact has its license text in this
directory.

## `ruby_fmt.wasm` - CRuby and syntax_tree

Built by `build/ruby_fmt/build.sh`; the gem versions are pinned in
`build/ruby_fmt/Gemfile`.

| Component | Version | License | Text |
|---|---|---|---|
| CRuby | 4.0.0 | Ruby License / BSD-2-Clause | `cruby-COPYING`, `cruby-BSDL`, `cruby-LEGAL` |
| syntax_tree | 6.3.0 | MIT | `syntax_tree-LICENSE` |
| prettier_print | 1.2.1 | MIT | `prettier_print-LICENSE` |
| logger | 1.7.0 | Ruby License / BSD-2-Clause | `logger-COPYING` |
| json | 2.18.0 | Ruby License / BSD-2-Clause | `json-COPYING` |
| prism | 1.7.0 | Ruby License / BSD-2-Clause | `cruby-COPYING`, `cruby-BSDL` |
| js (ruby.wasm) | 2.10.1 | MIT | see below |
| wasi-libc | from wasi-sdk 24 | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT, with parts under MIT (musl) and BSD-2-Clause (cloudlibc) | `wasi-libc-LICENSE`, `wasi-libc-LICENSE-APACHE-LLVM`, `wasi-libc-LICENSE-APACHE`, `wasi-libc-LICENSE-MIT`, `wasi-libc-musl-COPYRIGHT`, `wasi-libc-cloudlibc-LICENSE` |

The `js` gem ships no license file of its own; its gemspec declares **MIT**, and
it is part of [ruby/ruby.wasm](https://github.com/ruby/ruby.wasm), whose MIT
license covers it.

`json` and `prism` are CRuby default gems, compiled into CRuby itself. The
formatter does not use either directly, but both are inside the artifact, so
they are listed. prism carries no separate license
in the CRuby tree; it is covered by `cruby-COPYING` and `cruby-BSDL` along with
the rest of CRuby.

CRuby itself embeds third-party code under its own terms - Onigmo (the regex
engine), `dtoa.c`, `st.c`, and parts of `addr2line.c` among them. Ruby tracks
those in its `LEGAL` file, reproduced verbatim here as `cruby-LEGAL`, because
that code is compiled into the artifact along with the rest of CRuby.

wasi-libc is statically linked by wasi-sdk rather than downloaded as source, and
the wasi-sdk tarball carries no license, so its texts come from
[WebAssembly/wasi-libc](https://github.com/WebAssembly/wasi-libc) at the
`wasi-sdk-24` tag. Its top-level `LICENSE` names the third-party code inside it;
the texts for each part linked here are alongside.

`ruby_wasm`, wizer and binaryen are build-time tools. They produce the artifact
and no part of them is embedded, so they are not listed.

RuboCop used to be in this artifact, with eleven gems it depends on. It is not
any more - the RuboCop pass is the artifact below - so none of them are listed.

## `rbcop_fmt.wasm` - the RuboCop pass

Built by `build/rbcop_fmt/build.sh`. Everything for it is under `rbcop/`, and
`build/rbcop_fmt/collect-licenses.py` regenerates that directory from the
lockfile on every build, so it lists exactly what the artifact links.

| Component | Version | License | Text |
|---|---|---|---|
| [rbcop](https://github.com/costajohnt/rbcop) | 0.1.4, at the commit `build.sh` pins | MIT | `rbcop/rbcop-LICENSE` |
| [RuboCop](https://github.com/rubocop/rubocop) | 1.92.2 | MIT | `rbcop/rubocop-LICENSE` |
| rubocop-performance, rubocop-rails, rubocop-minitest, rubocop-rspec, rubocop-rspec_rails, rubocop-factory_bot, rubocop-capybara | the versions rbcop targets | MIT | `rbcop/rubocop-<name>-LICENSE` |
| unicode-display_width, unicode-emoji | 3.3.0, 4.3.0 | MIT | `rbcop/unicode-display_width-MIT-LICENSE.txt`, `rbcop/unicode-emoji-MIT-LICENSE.txt` |
| Prism (C parser, via `ruby-prism-sys`) | 1.9.0 | MIT | `rbcop/crates/ruby-prism-sys-1.9.0/` |
| RBS (C parser, via `ruby-rbs-sys`) | 0.3.0 | BSD-2-Clause (or the Ruby license) | `rbcop/crates/ruby-rbs-sys-0.3.0/` |
| rubydex | 0.4.1 | MIT | `rbcop/crates/rubydex-0.4.1/` |
| 67 crates in all, the three above included | pinned by `build/rbcop_fmt/entry/Cargo.lock` | MIT, Apache-2.0, Unlicense, BSD-2-Clause, BSL-1.0 or Unicode-3.0 | each crate's own files under `rbcop/crates/`, listed in `rbcop/CRATES.md` |
| Rust standard library | the toolchain `build.sh` uses | MIT OR Apache-2.0 | `rbcop/rust-std-MIT.txt`, `rbcop/rust-std-Apache-2.0.txt`, `rbcop/rust-std-LLVM-exception.txt` |
| wasi-libc | from wasi-sdk 25 | as above, plus BSD-3-Clause (musl-fts) | `rbcop/wasi-libc-*` |

rbcop is a reimplementation of RuboCop: its cop logic, messages and behaviour
are ported from RuboCop's source, and RuboCop's own `config/default.yml` and
`config/obsoletion.yml` are compiled in. So are the default configurations of
the seven plugins rbcop runs natively. All eight are MIT, and their licenses are
reproduced here because their code and configuration are inside the binary,
not because this package uses the plugins - the pass runs the Layout department
only.

The display-width table rbcop compiles in was generated from
unicode-display_width, which takes its emoji data from unicode-emoji, so both
are credited. Its encoding table was generated from CRuby's transcoders, which
`cruby-COPYING` and `cruby-BSDL` above already cover.

Three crates are published without a license file: `line-index` (from
rust-analyzer), and `ruby-rbs` and `ruby-rbs-sys` (which vendor the RBS parser).
rbcop also compiles in rubocop-performance's configuration without shipping its
license. The texts for those four come from upstream, and
`build/rbcop_fmt/upstream-licenses/README.md` records where each was fetched
from.

`CRATES.md` includes the handful of procedural-macro crates (`syn`, `quote`,
`serde_derive` and their kind). They run at build time and generate code rather
than being linked themselves, so their texts are a courtesy rather than an
obligation. The collector includes them because it reads the whole dependency
graph rather than guessing which parts are linked.
