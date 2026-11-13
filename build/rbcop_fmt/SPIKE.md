# rbcop on wasm: spike

[rbcop](https://github.com/costajohnt/rbcop) is RuboCop 1.92.2 reimplemented in
Rust on Prism, built to give byte-identical output. This spike asks whether it
can replace the RuboCop half of `packages/ruby`, which today runs
`rubocop --autocorrect --only Layout` on CRuby compiled to wasm.

Short answer: it compiles to `wasm32-wasip1`, runs under plain Node's WASI, and
matched native RuboCop 1.92.2 byte for byte on the first corpus tested. It is
now the package's RuboCop pass; see [Since the spike](#since-the-spike) for
what changed on the way in, including the one rbcop bug a larger corpus found.

## Building it

`build.sh` does the whole build. Nothing in rbcop is fundamentally non-portable.
The work was in four places:

1. **C under the Rust.** Prism and RBS are C parsers, so they need a wasi
   sysroot. `ruby-prism-sys` already supports `WASI_SDK_PATH`. `ruby-rbs-sys`
   needs `-D_WASI_EMULATED_MMAN`.
2. **bindgen produced no functions for RBS.** clang's wasm32 target defaults to
   hidden visibility and bindgen skips hidden functions. Prism marks its API
   `visibility("default")` and RBS does not, so only RBS was affected.
   `-fvisibility=default` fixes it.
3. **rubydex asserts 64-bit struct sizes.** These are compile-time layout
   checks, not correctness checks, so the patch gates them to 64-bit.
4. **rbcop's file plumbing is unix-only.** That covers `openat`-relative atomic
   writes, inode identity, terminal width, execute bits and `uname`. The patch
   gates each behind `cfg(unix)`. A single-file formatter never reaches any of
   them.

The same patch carries one fix to rbcop's behaviour, described under
[Since the spike](#since-the-spike).

The binary is `entry/`, not rbcop's CLI. It calls the library's
`autocorrect::correct_bytes` with `--only Layout` and `-a` semantics. The CLI
also links a result cache, an LSP and an MCP server that do not build for WASI
and that a formatter does not need.

## Conformance

The corpus was 300 real Ruby files (1-16 KB) taken from the CRuby 3.3 standard
library and RuboCop's own gem dependencies. Each file went through this
package's syntax_tree pass first, because that output is what the RuboCop pass
receives. Then three tools ran on the same input with the package's config:

| | identical to native RuboCop 1.92.2 |
|:---|---:|
| rbcop on wasm (this spike) | **300 / 300** |
| rbcop native, with the patch applied | 300 / 300 |
| `@scalar/ruby-fmt` today (RuboCop 1.91.0 on CRuby wasm) | 300 / 300 |

Native RuboCop made 558 corrections over 141 of the files, so the agreement
covers real corrections, not only unchanged input.

The three divergences in `test/rubocop-conformance.test.ts` (rubocop/rubocop#15761,
patched in `src/rubocop-patch.ts`) come out correct from rbcop. Native RuboCop
1.92.2 also gets them right, so the fix has shipped upstream. Moving to 1.92.2
semantics would let that patch retire.

## Cost

These timings come from one machine over the same 300 files.

| | per file |
|:---|---:|
| RuboCop pass today, in the warm CRuby VM | ~80 ms |
| rbcop on wasm, fresh instance per file | ~35 ms |
| of which is instantiation and config load | ~33 ms |
| of which is the Layout pass | **~4 ms** |

The fresh-instance figure is a worst case. This build is a WASI command, so
every call instantiates the module again and re-parses RuboCop's `default.yml`.
A reactor build that keeps one instance and caches the resolved config would
pay only the ~4 ms. That makes the RuboCop pass about 20x cheaper, and a full
format (syntax_tree is ~24 ms) about 3.5x cheaper.

| artifact | raw | brotli |
|:---|---:|---:|
| `rbcop_fmt.wasm` | 19.3 MB | 2.5 MB |
| `ruby_fmt.wasm.br` today | 74 MB | 13.9 MB |

Under Node, running hundreds of instances back to back in one process can crash
it unless they are collected between runs (`--expose-gc` and `gc()`). Each
instance reserves a large region of virtual address space. A reactor build with
one long-lived instance avoids this.

## What it did not change, at the time

This section is superseded - see the last entry under
[Since the spike](#since-the-spike) - and kept because it records why the
decision first went the other way.

rbcop does not reprint. It is RuboCop, and the package README already shows
why RuboCop alone is not enough: on 116 files that differed only in line
breaking, it mapped none of them to a common result. **syntax_tree, and the
CRuby VM it needs, stays.** That includes the VM's linear-memory leak and its
recycling. Those are properties of the CRuby half, and so is most of cold
start: ~0.70 s of today's ~0.86 s happens with RuboCop turned off.

## Exactness

rbcop reimplements RuboCop. It is not RuboCop compiled to wasm. By this repo's
rule (CLAUDE.md, "Exactness is a claim about a named tool"), the RuboCop half
would stop being exact by construction. It would become exact by test: the
conformance suite against the real `rubocop` binary would be the only thing
that backs the claim. The status table and the package README would have to
say so.

## Since the spike

- The entry is a WASI reactor (`entry/src/lib.rs`): instantiated once, called
  per format, with every resolved config cached. The ~33 ms of fixed overhead
  per call measured above is paid once per config instead, so a call costs the
  Layout pass alone - ~4 ms a file through the package, measured end to end.
- Configs that need Ruby (ERB, remote `inherit_from`) are errors. rbcop warns
  and carries on without them, which would quietly differ from RuboCop.
- `packages/ruby` loads it beside the Ruby artifact, under Node and in the
  browser, and the Ruby artifact no longer carries RuboCop: 13.9 MB of
  artifacts became 7.9 MB, and the Ruby VM stopped growing with every file.
- `build/licenses/collect.py` regenerates `packages/ruby/licenses/NOTICE.md` -
  the notices for everything linked into both artifacts - on every build.
- A second corpus, 2,754 files from the Ruby 3.3 standard library and the
  oracle gems, found one rbcop bug on 10 files.
  `Layout/MultilineOperationIndentation` re-indented the wrapped operand of
  `/regex/ =~ operand`. Parser builds `match_with_lvasgn` for that rather than
  a `send`, so RuboCop's cop never visits it. rbcop already handles this shape
  in `Layout/RedundantLineBreak` and `Layout/SpaceAroundOperators`, and
  `rbcop-wasm.patch` adds the same four-line guard to this cop. rbcop's own
  test suite passes with it, apart from five config scenarios that fail
  identically without it, because they need gems this machine lacks. With the
  fix, all 2,754 files match native RuboCop 1.92.2, and so do the 300 above. It
  is worth reporting upstream so the patch can retire.
- A `case/in` guard continued over lines (`in x if a &&` then `b`) came back
  aligned with the guard's condition, where RuboCop indents it 2 from the `in`.
  Prism wraps the guard in an if node, and the Layout/Multiline*Indentation
  cops took it for a keyword condition; the parser gem's `if_guard` is never
  one. The fix is in rbcop itself and landed upstream in costajohnt/rbcop#718, so
  `build.sh` builds from upstream at that merge, whose tree is identical to the
  fork commit it used to pin. Rebuilt from upstream, the artifact is byte for
  byte the one the fork produced.
- **The reprinter went.** Line-structured input - generated code, which is what
  the package is mostly given - does not need one: formatted through both
  pipelines from the same input with the same Layout config, 6,737 generated
  `.rb` and `.rbi` files took 180 s with the reprinter and 14 s without, the
  RuboCop-only output had no errors, no file `ruby -c` rejected, and a second
  pass changed nothing. So `packages/ruby` is now this module alone: one
  artifact, no CRuby VM, no recycling, and a boot that is synchronous under
  Node. `Layout/LineLength` is on, since there is no longer a printer to own
  line width. The entry also refuses unparseable input up front, which the
  reprinter used to do, rather than letting it reach the output check and be
  reported as a bug in the pass.
- With the reprinter gone, raw input reaches rbcop, and a 2,184-file corpus
  (the Ruby 3.3 standard library, rubocop, rubocop-ast, parser, syntax_tree and
  prism's generated `.rbi` files) found one more bug, in the standard library's
  `time.rb`: `Layout/EmptyLineAfterGuardClause` skipped a guard clause followed
  by a statement on its line (`break if a; b = 1`) everywhere. RuboCop skips it
  only when the two share a `begin` node, and parser gives a `begin ... end`
  without rescue no such node, so there RuboCop flags it - and, when it is the
  last statement before `end`, loops against `Layout/EmptyLinesAroundBeginBody`
  until it reports an infinite loop. `rbcop-wasm.patch` makes the skip depend on
  the same distinction. With it the corpus matches at both widths the
  conformance test runs, with RuboCop's give-up matched by a rejection.
