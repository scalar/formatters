---
'@scalar/kotlin-fmt': minor
---

Replace the TeaVM-compiled ktfmt 0.64 with [ktrs](https://github.com/Hexay/ktrs) 0.5.3, a Rust reimplementation of ktfmt, compiled to wasm. Output is held to ktfmt **0.65** by a conformance test that runs the real ktfmt jar. That test asserts byte-identical output and matching diagnostics; over okhttp and kotlinx.coroutines (1,699 files) in every style, every file matched.

The artifact goes from 0.82 MB to 0.20 MB and imports nothing, so `formatSync` now works under Node without `init()`, and the Node floor drops from 24.15.0 to 18.

Breaking changes:

- The `./runtime` export (TeaVM's generated runtime) is gone. There is no runtime file any more.
- The `BootModule`, `FormatFunction` and `ModuleLoader` types are removed. `ArtifactSource`, `KotlinFormatter` and `KotlinFormatterBoot` take their place.
- `ktfmtVersion` is now `'0.65'`, and `ktrsVersion` is new.
- Parse errors read as ktfmt's CLI prints them, without the file name (`1:7: error: Expecting ')'`), instead of carrying a Java class name prefix (`...ParseError: 1:7: ...`).
- An unknown `style` or `trailingCommas`, or a negative or fractional width or indent, now throws instead of silently falling back to a default.
