---
"@scalar/swift-fmt": minor
---

The bundled swift-format moves from 603.0.0 to 604.0.0, compiled by the Swift 6.4.0 toolchain and Swift SDK for WebAssembly (from 6.3.3). **This can change output.** A consumer comparing against a native `swift-format` in CI should move to 604.0.0 too. `test/native-conformance.test.ts` asserts byte-identical output against a native swift-format 604.0.0 built from the same tag, and passes.

The one new configuration key in 604, `OrderedImports.shouldGroupImports`, is nested under a rule's configuration, which `FormatOptions` does not expose, so the options type is unchanged.
