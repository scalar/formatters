# @scalar/kotlin-fmt

## 0.4.1

### Patch Changes

- 97684ad: Run `wasm-opt -O3` over the TeaVM output, shrinking both artifacts and speeding up formatting

  The build skipped Binaryen because its output was rejected by V8 with `type error in branch[0] (expected (ref exn), got exnref)` at every optimisation level. That was never Binaryen's bug: the reference interpreter sends a non-nullable `(ref exn)` to a `catch_ref` label, which is what Binaryen models, and V8 was the side typing it as a nullable `exnref`. V8 has since been fixed, so the pass is simply available.

  `@scalar/java-fmt` drops from 0.83 MB to 0.77 MB and `@scalar/kotlin-fmt` from 0.91 MB to 0.82 MB, and formatting gets about 14% faster. Output is unchanged, which is what the conformance corpora assert: 658/658 Java files byte-identical in both styles, and 1767/1767 Kotlin comparisons across all three.

  The engine floor is unchanged at Node 24.15, but it is now a hard one: the optimised module does not compile on Node 22 at all, where the previous artifact ran (and then leaked). The boot check's probe was replaced to match — it now compiles the same `catch_ref`-into-`(ref exn)` shape the artifact uses, rather than a bare `try_table` that Node 22 accepts while rejecting the module, so an unsupported engine still gets this package's own message instead of a raw `CompileError`.

## 0.4.0

### Minor Changes

- 73c6ddb: Stop the Kotlin formatter printing to stderr, and expose the tool version both
  packages carry

  `@scalar/kotlin-fmt` wrote a Java stack trace to `console.error` once per
  process:

  ```
  java.lang.UnsupportedOperationException: LockSupport.park would block the only thread
  ```

  Four lines under bun, forty under Node, where the exception arrives with fake
  stack frames attached. It landed on the timer turns _after_ the first `format`
  resolved rather than during it, so a run that formatted 121 files printed it
  once, in the middle of a pass that had succeeded, and it looked like a
  diagnostic about the file being formatted. It was not: formatting was correct
  throughout.

  It came from opening ktfmt's parser. That builds an IntelliJ
  `CoreProjectEnvironment`, which launches two coroutines and so starts
  kotlinx-coroutines' scheduler, whose workers park waiting for work. Parking is
  the one thing a single-threaded wasm runtime cannot do, so each worker died with
  an `UnsupportedOperationException` that TeaVM's default handler printed. On a
  JVM those same workers park and idle forever; either way the formatting is
  finished. The module now installs a handler that drops exactly that — an
  `UnsupportedOperationException` whose message is one of the single-threaded
  stand-ins refusing — and prints everything else, so a genuine failure on one of
  those coroutines is still reported. Output is unchanged: 589 Kotlin files in all
  three styles are still byte-identical to ktfmt 0.64 on a JVM.

  Both packages also export the version of the tool they carry:

  ```js
  import { ktfmtVersion } from "@scalar/kotlin-fmt";
  import { googleJavaFormatVersion } from "@scalar/java-fmt";
  ```

  Exactness is a claim about a named release, and a consumer that re-verifies its
  own committed bytes with the native jar needs that release to install the
  matching one. Reading it off the package means the number is not pinned twice,
  once here and once downstream; a test holds each constant to the version its
  build script actually compiles.

  One thing documented rather than changed: google-java-format is not idempotent
  in `aosp` style on a reflowed string literal — it writes the `+` continuation at
  a hardcoded four columns and re-indents to eight on the next run. This build
  reproduces that at every pass, because it is that build, so formatting here and
  then verifying with the jar compares pass one against pass two and looks like a
  divergence that is not one. `packages/java/README.md` has the detail and the two
  ways out.

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
