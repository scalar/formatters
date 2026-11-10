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

## What it does not change

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
