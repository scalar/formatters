# Third-party notices

`ruby_fmt.wasm` is a compiled artifact that **embeds** the software below. The
sources are no longer visible in this tree — they are inside the binary — so
their licenses are reproduced here, as those licenses require.

Built by `build/ruby_fmt/build.sh`; the gem versions are pinned in
`build/ruby_fmt/Gemfile`.

| Component | Version | License | Text |
|---|---|---|---|
| CRuby | 3.4.1 | Ruby License / BSD-2-Clause | `cruby-COPYING`, `cruby-BSDL`, `cruby-LEGAL` |
| syntax_tree | 6.3.0 | MIT | `syntax_tree-LICENSE` |
| prettier_print | 1.2.1 | MIT | `prettier_print-LICENSE` |
| rubocop | 1.74.0 | MIT | `rubocop-LICENSE.txt` |
| rubocop-ast | 1.42.0 | MIT | `rubocop-ast-LICENSE.txt` |
| parser | 3.3.12.0 | MIT | `parser-LICENSE.txt` |
| ast | 2.4.3 | MIT | `ast-LICENSE.MIT` |
| racc | 1.8.1 | Ruby License / BSD-2-Clause | `racc-COPYING` |
| regexp_parser | 2.12.0 | MIT | `regexp_parser-LICENSE` |
| unicode-display_width | 3.2.0 | MIT | `unicode-display_width-MIT-LICENSE.txt` |
| unicode-emoji | 4.2.0 | MIT | `unicode-emoji-MIT-LICENSE.txt` |
| rainbow | 3.1.1 | MIT | `rainbow-LICENSE` |
| parallel | 1.28.0 | MIT | `parallel-MIT-LICENSE.txt` |
| lint_roller | 1.1.0 | MIT | `lint_roller-LICENSE.txt` |
| ruby-progressbar | 1.13.0 | MIT | `ruby-progressbar-LICENSE.txt` |
| language_server-protocol | 3.17.0.6 | MIT | `language_server-protocol-LICENSE.txt` |
| json | 2.9.1 | Ruby License / BSD-2-Clause | `json-COPYING` |
| logger | 1.7.0 | Ruby License / BSD-2-Clause | `logger-COPYING` |
| js (ruby.wasm) | 2.10.1 | MIT | see below |

Everything from `rubocop` down to `language_server-protocol` arrives because
RuboCop depends on it. Several are never reached by a formatting call -
`ruby-progressbar` and `language_server-protocol` back the CLI's progress bar
and its language server - but they are inside the artifact, so they are listed.

The `js` gem ships no license file of its own; its gemspec declares **MIT**, and
it is part of [ruby/ruby.wasm](https://github.com/ruby/ruby.wasm), whose MIT
license covers it.

CRuby itself embeds third-party code under its own terms - Onigmo (the regex
engine), `dtoa.c`, `st.c`, and parts of `addr2line.c` among them. Ruby tracks
those in its `LEGAL` file, reproduced verbatim here as `cruby-LEGAL`, because
that code is compiled into the artifact along with the rest of CRuby.

`ruby_wasm` is a build-time dependency only. It produces the artifact and no
part of it is embedded, so it is not listed above.

## Known gap

The artifact statically links **wasi-libc** from wasi-sdk 22.0, whose license
text is not reproduced here - the wasi-sdk tarball this build downloads does not
carry one, so it has to be sourced from upstream
([WebAssembly/wasi-libc](https://github.com/WebAssembly/wasi-libc)) rather than
copied out of the build tree. It is dual Apache-2.0-with-LLVM-exception / MIT;
both require attribution in binary redistributions.
