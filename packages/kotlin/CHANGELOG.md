# @scalar/kotlin-fmt

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
