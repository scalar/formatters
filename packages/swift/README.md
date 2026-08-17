# Scalar Swift Formatter

[![Version](https://img.shields.io/npm/v/%40scalar%2Fswift-fmt)](https://www.npmjs.com/package/@scalar/swift-fmt)
[![Downloads](https://img.shields.io/npm/dm/%40scalar%2Fswift-fmt)](https://www.npmjs.com/package/@scalar/swift-fmt)
[![License](https://img.shields.io/npm/l/%40scalar%2Fswift-fmt)](https://www.npmjs.com/package/@scalar/swift-fmt)
[![Discord](https://img.shields.io/discord/1135330207960678410?style=flat&color=5865F2)](https://discord.gg/scalar)

Swift formatter that runs on plain Node. No Swift toolchain, no `swift` on `PATH`, no Xcode, no postinstall download.

---

Scalar is an open-source API platform for teams who want beautiful developer interfaces without vendor lock-in.

- **[API References](https://scalar.com/products/api-references/getting-started)** — Interactive API documentation from OpenAPI and AsyncAPI specs.
- **[Developer Docs](https://scalar.com/products/docs/getting-started)** — Write in Markdown/MDX, generate API references, sync with two-way Git.
- **[SDK Generator](https://scalar.com/products/sdk-generator/getting-started)** — Type-safe SDKs and CLIs in TypeScript, Python, Go, PHP, Java, and Ruby.
- **[API Client](https://scalar.com/products/api-client/getting-started)** — Open-source, offline-first Postman alternative built on OpenAPI.

20M+ monthly npm installs · 15,500+ GitHub stars · MIT licensed · [scalar.com](https://scalar.com)

---

```bash
npm i @scalar/swift-fmt
```

```js
import { format } from '@scalar/swift-fmt'

await format('struct P{var x:Int\nvar y:Int}')
// struct P {
//   var x: Int
//   var y: Int
// }
```

Async because the first call decompresses the artifact, compiles it and boots
the module — about 0.5s. That work is cached, so every later call is ~30ms.

Options are swift-format's own configuration keys, spelled the way a
`.swift-format` file spells them — `{ lineLength }`, `{ indentation }`,
`{ tabWidth }`, `{ respectsExistingLineBreaks }`, `{ rules }`, and the rest.
Anything you leave out keeps swift-format's default, because the real
`Configuration` type fills absent keys in itself.

```js
await format(source, { lineLength: 120, indentation: { spaces: 4 } })
await format(source, { rules: { OrderedImports: false } })
```

## It runs in the browser too

The import does not change — bundlers and browsers pick the `browser` export
condition on their own, and `format` has the same signature and returns the same
bytes. Only the wasm's route in differs: fetched rather than read from disk.

```js
import { format, init } from '@scalar/swift-fmt'

// Optional. The artifact resolves next to the module by default, which Vite,
// Rollup, webpack and a plain CDN handle unaided. esbuild does not rewrite
// `new URL(..., import.meta.url)`, so there it needs naming.
await init({ url: '/assets/swift_fmt.wasm.br' })

await format(source)
```

Run it in a worker. Booting compiles 48.7 MB of wasm, which is a visibly frozen
tab if it happens on the main thread.

This is the largest artifact in the repo by a wide margin. Load it behind an
explicit user action rather than on page load, and give it a worker — `init`
exists partly so that download can be scheduled deliberately.

The browser reads the same brotli artifact as Node (12.4 MB over the wire) and
expands it with `DecompressionStream('brotli')` where the engine has it, or a
208 KB wasm decoder where it does not — Chrome, today. Serving the artifact with
`Content-Encoding: br`, or serving an uncompressed `.wasm`, skips the decoder
entirely:

```js
await init({ url: '/assets/swift_fmt.wasm', encoding: 'none' })
```

## This is the real swift-format, and the output is exact

This is **actual [swift-format](https://github.com/swiftlang/swift-format)
603.0.0** — the same version that ships with Swift 6.3, swift-syntax and all —
compiled to WebAssembly by the official
[Swift SDK for WebAssembly](https://www.swift.org/documentation/articles/wasm-getting-started.html).
It is not a reimplementation, so it does not drift.

`test/native-conformance.test.ts` asserts byte-identical output against a
native `swift-format`, across structs, generics, closures, async/await,
protocols, property wrappers, result builders, string interpolation and doc
comments, in both the default configuration and a non-default one. That test
*asserts* rather than reports: any divergence is a real bug. It skips cleanly
when no native `swift-format` is around, so a toolchain-free checkout still
passes.

Beyond the samples in that test, the build was checked against 689 real Swift
files — the sources and tests of swift-format itself, plus swift-syntax,
swift-argument-parser and swift-markdown — formatted by both the wasm build and
the native CLI. All 689 came out byte-identical.

## `format()` wraps the library, because the CLI cannot be compiled

swift-format's executable target imports Dispatch, and the WASI SDK ships no
libdispatch, so `swift-format` itself does not build for wasm at all. What
builds — cleanly — is the `SwiftFormat` library the CLI is a front end for.

That is a smaller gap than it sounds. `swift-format format <file>` resolves a
configuration and then calls exactly one method,
`SwiftFormatter.format(source:assumingFileURL:selection:to:)`, with no
additional pipeline steps. (Contrast google-java-format, whose CLI runs three
more passes after formatting.) So the wrapper is that call, and the output is
the tool's.

**The one behaviour left out is configuration discovery.** The CLI walks up the
filesystem looking for a `.swift-format` file. There is no filesystem here to
walk, so if your project has one, read it and pass it in:

```js
import { readFileSync } from 'node:fs'

const config = JSON.parse(readFileSync('.swift-format', 'utf8'))
await format(source, config)
```

Worth knowing if you compare this package against your project's CLI output and
see a difference: check that both are using the same configuration before
concluding anything. A `.swift-format` the CLI silently picked up is by far the
likeliest explanation.

## How it is built, and two things that bite

It ships as a 13MB `swift_fmt.wasm.br` — 51MB of wasm, brotli-compressed —
built by [`build/swift_fmt/build.sh`](../../build/swift_fmt/build.sh). It is
committed, so a fresh clone needs nothing extra; `bun run swift:build` rebuilds
it. The build downloads its own Swift toolchain and Swift SDK, so neither tests
nor consumers ever need one.

It is larger than the other packages here (Ruby 3.8MB, Java 4.4MB) and that is
mostly swift-syntax, which is a full Swift parser. `-Osize` and `wasm-opt -Oz`
were both tried; neither moved the compressed size by more than 50KB.

Two things about the build are load-bearing rather than incidental:

**The default wasm stack overflows on ordinary Swift.** swift-syntax's own
`UnicodeScalarExtensions.swift` is 10KB and chains about 70 `||` operators into
a single expression; walking a tree that deep traps with `memory access out of
bounds`. The build links with `-z stack-size=16777216`. Without it the artifact
looks fine until it meets a real file.

**The SDK has to be named by id, not by triple.** The normal and embedded Swift
SDKs both declare `wasm32-unknown-wasip1`, so passing the triple is ambiguous
and resolves to the embedded one — which fails deep inside swift-syntax with
`conformance of 'AnyKeyPath' to 'Equatable' is unavailable: unavailable in
embedded Swift`.

## The module is a reactor, and it does not leak

The artifact is a WASI *reactor*: it is instantiated once and its `run` export
is called per format, rather than being re-instantiated for each one. Over a
442-file corpus that measured 2.5x faster (31ms vs 79ms per file) with
byte-identical output.

Unlike the Ruby package's VM, which leaks about 74MB per 23KB of input and has
to be recycled before it hits the wasm32 boundary, this one is flat: 54MB after
boot, 75MB after the first hundred files, and still 75MB after 7.2MB of
cumulative input. There is nothing to recycle.

The one case that does drop the instance is a trap. A trap leaves the Swift
runtime mid-call with no way to unwind, so the cached instance is discarded and
the next call boots a fresh one — a crash costs an instantiate, not a
process.

## Community

We are API nerds. You too? Let's chat on Discord: <https://discord.gg/scalar>

## License

MIT for this package's own source. The artifact embeds swift-format, the Swift
standard library and Foundation, all Apache-2.0 with the Runtime Library
Exception, plus swift-cmark under BSD-2-Clause. All permissive; see
[`licenses/NOTICE.md`](./licenses/NOTICE.md).

Unlike the Java package, there is no redistribution restriction here — the whole
toolchain is open source, so a paid product that ships a copy is fine.
