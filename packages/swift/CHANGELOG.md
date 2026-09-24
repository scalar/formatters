# @scalar/swift-fmt

## 0.3.0

### Minor Changes

- 28460c0: The bundled swift-format moves from 603.0.0 to 604.0.0, compiled by the Swift 6.4.0 toolchain and Swift SDK for WebAssembly (from 6.3.3). **This can change output.** A consumer comparing against a native `swift-format` in CI should move to 604.0.0 too. `test/native-conformance.test.ts` asserts byte-identical output against a native swift-format 604.0.0 built from the same tag, and passes.
  
  The one new configuration key in 604, `OrderedImports.shouldGroupImports`, is nested under a rule's configuration, which `FormatOptions` does not expose, so the options type is unchanged.

### Patch Changes

- 89e8c7e: Formatting is about 20% faster. The artifact is now compiled with `-O` and `wasm-opt -O3` instead of `-Osize` and `wasm-opt -Os`.
  
  Profiling showed almost all of a format's time going to swift-syntax and SwiftFormat inside the wasm, with the JavaScript host under 2%. That makes the compiler's optimisation level the setting that matters. Formatting 1,296 files of real Swift (12.4 MB of source from swift-format, swift-syntax, swift-markdown and swift-argument-parser) in one Node process now takes 27.1 s instead of 33.7 s. The artifact grows by 60 KB, to 12.5 MB over the wire. Linear memory is unchanged: 57 MB after boot and 70 MB after the whole corpus. Deeply nested source also has more room before it exhausts the stack. A chain of `||` operands now traps at about 1,500 operands, up from about 1,200.
  
  The output is unchanged. All 1,296 files come out byte-identical to native swift-format 6.3.3, and `test/native-conformance.test.ts` passes against it.

## 0.2.0

### Minor Changes

- 866c05c: Run in the browser

  These six packages now ship a `browser` export condition alongside the Node
  entry. The import does not change and neither does the API — `format` has the
  same signature and produces the same bytes — but bundlers and browsers now
  resolve a build that fetches the wasm artifact instead of reading it from disk.
  A new `init({ url, bytes, encoding })` is exported from the browser entry for
  callers whose artifact does not sit where the default resolves it.

  Every package also gains `formatSync`, a synchronous entry point for callers
  with no `await` to give - a code generator that formats each file inside the
  synchronous builder that emits it, for instance. `init` boots the module once;
  `formatSync` throws until it has. This is additive: booting was always the only
  asynchronous step, so `formatSync` runs the same code `format` did after its
  await, and both produce the same bytes.

  Ruby's `formatSync` carries one caveat, because recycling its VM is asynchronous
  too: it refuses once the VM outgrows what a synchronous caller can clear, and
  says to `await init()` again. The limit is set well above the ceiling `format`
  recycles at, so the pauses are rare.

  The Node entry is unchanged and remains the default for every existing consumer.

  Nothing is duplicated to make this work: the browser reads the same committed
  brotli artifact, expanding it with `DecompressionStream('brotli')` where the
  engine has it and a lazily imported 208KB wasm decoder where it does not. Serving
  the artifact with `Content-Encoding: br`, or serving an uncompressed `.wasm`,
  skips the decoder — `init({ encoding: 'none' })`.

  Ruby also changes on the Node side: `compileArtifact` now uses
  `WebAssembly.compile` rather than the synchronous `Module` constructor, which no
  public API was built around.

  C# additionally accepts `init({ runtimeBaseUrl })`, because it is the one
  package whose assets are not all bytes: the .NET runtime imports four
  `runtime/*.js` files as ES modules by URL. They resolve next to the module by
  default and Vite, Rollup and webpack emit them as hashed assets unaided.

  One caveat worth knowing: Vite, Rollup and webpack rewrite
  `new URL(..., import.meta.url)`, and esbuild does not. Under esbuild the
  artifact needs copying beside the output or naming with `init({ url })`.
