---
"@scalar/csharp-fmt": patch
---

Rebuilt on the .NET 10.0.15 runtime (from 10.0.12), which is a security release. CSharpier stays at 1.3.0, still its latest release, and `test/native-conformance.test.ts` still asserts byte-identical output against a native `csharpier` 1.3.0.
