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
| logger | 1.7.0 | Ruby License / BSD-2-Clause | `logger-COPYING` |
| js (ruby.wasm) | 2.10.1 | MIT | see below |

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
