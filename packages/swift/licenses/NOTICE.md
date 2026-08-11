# Third-party notices

`swift_fmt.wasm` is a compiled artifact that **embeds** the software below. The
sources are no longer visible in this tree — they are inside the binary — so
their licenses are reproduced here, as those licenses require.

Built by `build/swift_fmt/build.sh`; the versions are pinned there.

| Component | Version | License | Text |
|---|---|---|---|
| swift-format | 603.0.0 | Apache-2.0 with Runtime Library Exception | `swift-format-LICENSE` |
| swift-syntax | pinned by swift-format's `Package.resolved` | Apache-2.0 with Runtime Library Exception | same text |
| swift-markdown | pinned by swift-format's `Package.resolved` | Apache-2.0 with Runtime Library Exception | same text |
| swift-cmark | pinned by swift-format's `Package.resolved` | BSD-2-Clause | `swift-cmark-LICENSE` |
| Swift standard library and Foundation | 6.3.3 | Apache-2.0 with Runtime Library Exception | `swift-runtime-LICENSE` |

Every one of these is permissive and asks only for attribution.

The **Runtime Library Exception** is the reason this artifact can be shipped
without the usual Apache-2.0 obligations attaching to the code that links
against it. It is reproduced at the end of `swift-format-LICENSE`, as the Swift
project distributes it.

`swift-argument-parser` is a dependency of swift-format's *CLI* target, which is
not built here — the CLI imports Dispatch, which the WASI SDK does not provide —
so no part of it is embedded and it is not listed above.

The Swift toolchain and the Swift SDK for WebAssembly are build-time
dependencies. They produce the artifact; only their runtime libraries end up
inside it, which is the last row above.

## Known gap

The artifact statically links **wasi-libc**, whose license text is not
reproduced here — it comes from inside the Swift SDK's WASI sysroot rather than
as a file the build unpacks. It is dual Apache-2.0-with-LLVM-exception / MIT;
both require attribution in binary redistributions. The text is upstream at
[WebAssembly/wasi-libc](https://github.com/WebAssembly/wasi-libc).
