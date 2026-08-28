---
'@scalar/ruby-fmt': patch
---

Ship the rebuilt artifact carrying RuboCop's pre-parsed default configuration

0.6.1 added `ScalarRubyFmt.warm` but shipped the artifact unchanged, so the work it saves was still being done at runtime — the source said the config was baked in, and the wasm said otherwise. This rebuilds it, and the change takes effect.

Merging a `.rubocop.yml` over RuboCop's own ~600-cop `default.yml` costs about half a second, is identical whatever a caller asks for, and used to happen once per VM: on the first RuboCop format and again after every recycle. Measured on one machine against the artifact this replaces:

| | before | after |
|:---|---:|---:|
| first RuboCop format on a fresh VM | 492 ms | **124 ms** |
| cold start, default | 1,181 ms | **857 ms** |
| one VM recycle | 359 ms | **60 ms** |
| cold start, `rubocop: false` | 695 ms | 698 ms |

That last row is the control — the syntax_tree path is untouched and did not move. Steady-state formatting did not move either (502 real files in 44.6 s against 44.9 s): the config was only ever parsed once per VM, so what this removes is a fixed cost per VM, not a cost per call. The artifact grows 12.2 MB → 12.7 MB, and a VM starts ~6 MB nearer its recycle ceiling.

Output is unchanged, checked rather than asserted: the corpus comparison `CONTRIBUTING.md` asks for reports 502 of 502 files byte-identical between the old artifact and this one.

Two build fixes were needed to produce it, both of which stopped `bun run ruby:build` from completing at all:

- `build.sh` now fetches its own pinned binaryen for `wasm-merge`. It had been reaching for the copy `rbwasm` downloads, which is version 108 — predating the tool entirely — so the build died on an ENOENT naming a path with no `wasm-merge` in it.
- `preinit.ts` sends each tool's output to a file rather than a pipe, and enables multimemory for the merge. `wasm-merge` warns per import it resolves, which overflowed `spawnSync`'s buffer and surfaced as ENOBUFS reported as "wasm-merge could not be run" — naming a binary that had run and succeeded. `maxBuffer` does not help, because Bun's `spawnSync` ignores it.
