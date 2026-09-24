---
"@scalar/swift-fmt": patch
---

Formatting is about 20% faster. The artifact is now compiled with `-O` and `wasm-opt -O3` instead of `-Osize` and `wasm-opt -Os`.

Profiling showed almost all of a format's time going to swift-syntax and SwiftFormat inside the wasm, with the JavaScript host under 2%. That makes the compiler's optimisation level the setting that matters. Formatting 1,296 files of real Swift (12.4 MB of source from swift-format, swift-syntax, swift-markdown and swift-argument-parser) in one Node process now takes 27.1 s instead of 33.7 s. The artifact grows by 60 KB, to 12.5 MB over the wire. Linear memory is unchanged: 57 MB after boot and 70 MB after the whole corpus. Deeply nested source also has more room before it exhausts the stack. A chain of `||` operands now traps at about 1,500 operands, up from about 1,200.

The output is unchanged. All 1,296 files come out byte-identical to native swift-format 6.3.3, and `test/native-conformance.test.ts` passes against it.
