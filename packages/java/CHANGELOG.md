# @scalar/java-fmt

## 0.3.0

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

## 0.2.0

### Minor Changes

- 35e6660: Raise the declared Node floor to 24.15.0, which is what these two artifacts
  have actually needed all along.

  TeaVM emits the final wasm exception-handling proposal — `try_table`, opcode
  0x1f, over `exnref`. V8 accepts it unflagged on Node 22, **rejects it on Node
  24.0 through 24.14**, and accepts it again from 24.15.0 on. On the releases in
  that gap the module fails to compile outright, before a single format call:

  ```
  CompileError: WebAssembly.compile(): Compiling function #92 failed:
  Invalid opcode 0x1f (enable with --experimental-wasm-exnref)
  ```

  `engines.node` said `>=24`, and the runtime check only compared the major, so
  anyone on Node 24.0–24.14 got that raw `CompileError` instead of an explanation.
  Both packages now check for the opcode too and throw naming the version and the
  `--experimental-wasm-exnref` escape hatch. That second check compiles a 28-byte
  probe module rather than reading a version number, so bun — JavaScriptCore,
  reporting a Node version of its own below the floor — is judged on what its
  engine actually does and keeps working unchanged.

  Nothing about the formatting changes; this is the floor being stated correctly.
  Consumers already on Node 24.15 or newer, or on bun, are unaffected.
