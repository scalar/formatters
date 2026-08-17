---
'@scalar/kotlin-fmt': minor
'@scalar/swift-fmt': minor
'@scalar/ruby-fmt': minor
'@scalar/java-fmt': minor
'@scalar/rust-fmt': minor
---

Run in the browser

These five packages now ship a `browser` export condition alongside the Node
entry. The import does not change and neither does the API — `format` has the
same signature and produces the same bytes — but bundlers and browsers now
resolve a build that fetches the wasm artifact instead of reading it from disk.
A new `init({ url, bytes, encoding })` is exported from the browser entry for
callers whose artifact does not sit where the default resolves it.

The Node entry is unchanged and remains the default for every existing consumer.

Nothing is duplicated to make this work: the browser reads the same committed
brotli artifact, expanding it with `DecompressionStream('brotli')` where the
engine has it and a lazily imported 208KB wasm decoder where it does not. Serving
the artifact with `Content-Encoding: br`, or serving an uncompressed `.wasm`,
skips the decoder — `init({ encoding: 'none' })`.

Ruby also changes on the Node side: `compileArtifact` now uses
`WebAssembly.compile` rather than the synchronous `Module` constructor, which no
public API was built around.

C# and PHP are unaffected and stay Node-only; the README says why.
