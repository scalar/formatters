# rbcop on wasm: spike

[rbcop](https://github.com/costajohnt/rbcop) is RuboCop 1.92.2 reimplemented in
Rust on Prism, built to give byte-identical output. This spike asks whether it
can replace the RuboCop half of `packages/ruby`, which today runs
`rubocop --autocorrect --only Layout` on CRuby compiled to wasm.

Short answer: it compiles to `wasm32-wasip1`, runs under plain Node's WASI, and
matched native RuboCop 1.92.2 byte for byte on every file tested. It is not
wired into the package yet; see [What is left](#what-is-left).

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
   them. The diff is 42 added lines, in `rbcop-wasm.patch`.

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

## What is left

1. A reactor entry: export `format(source, config) -> String` with the config
   cached across calls, instead of a `_start` per file.
2. A loader in `packages/ruby` for the second module, under Node and in the
   browser, and `format.ts` piping syntax_tree's output through it.
3. `test/rubocop-conformance.test.ts` pinned to RuboCop 1.92.2 (rbcop's target)
   and pointed at the new pass. Retire `rubocop-patch.ts` and
   `rubocop-perf-patch.ts`.
4. A rebuilt Ruby artifact without RuboCop. RuboCop takes part of the 7 MB
   pre-initialized heap, and the artifact should shrink by that much.
5. README, status table and NOTICE/licenses changes (rbcop is MIT).
