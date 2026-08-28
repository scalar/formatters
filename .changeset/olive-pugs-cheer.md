---
"@scalar/java-fmt": patch
"@scalar/kotlin-fmt": patch
---

Run `wasm-opt -O3` over the TeaVM output, shrinking both artifacts and speeding up formatting

The build skipped Binaryen because its output was rejected by V8 with `type error in branch[0] (expected (ref exn), got exnref)` at every optimisation level. That was never Binaryen's bug: the reference interpreter sends a non-nullable `(ref exn)` to a `catch_ref` label, which is what Binaryen models, and V8 was the side typing it as a nullable `exnref`. V8 has since been fixed, so the pass is simply available.

`@scalar/java-fmt` drops from 0.83 MB to 0.77 MB and `@scalar/kotlin-fmt` from 0.91 MB to 0.82 MB, and formatting gets about 14% faster. Output is unchanged, which is what the conformance corpora assert: 658/658 Java files byte-identical in both styles, and 1767/1767 Kotlin comparisons across all three.

The engine floor is unchanged at Node 24.15, but it is now a hard one: the optimised module does not compile on Node 22 at all, where the previous artifact ran (and then leaked). The boot check's probe was replaced to match — it now compiles the same `catch_ref`-into-`(ref exn)` shape the artifact uses, rather than a bare `try_table` that Node 22 accepts while rejecting the module, so an unsupported engine still gets this package's own message instead of a raw `CompileError`.
