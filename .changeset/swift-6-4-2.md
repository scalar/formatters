---
"@scalar/swift-fmt": patch
---

Rebuilt with the Swift 6.4.2 toolchain and Swift SDK for WebAssembly (from 6.4.0), and optimised with Binaryen 133 (from 123). swift-format stays at 604.0.0, still its latest release. `test/native-conformance.test.ts` asserts byte-identical output against a native swift-format 604.0.0 built from the same tag with the same toolchain, and passes, as do all 701 files of swift-format's sources and tests and of swift-syntax, swift-markdown and swift-argument-parser.
