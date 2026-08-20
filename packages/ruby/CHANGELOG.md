# @scalar/ruby-fmt

## 0.4.0

### Minor Changes

- 36995f5: `format` now runs RuboCop's Layout department after syntax_tree, so its output
  is clean under a consumer's own `rubocop` run rather than merely canonical.

  **This changes output.** syntax_tree alone leaves Layout offenses in about 30%
  of real files — mostly multiline operation and method-call indentation, where
  the two tools genuinely disagree — and those files now come back corrected.
  Pass `{ rubocop: false }` for the previous behaviour, exactly.

  Both tools run because neither does the whole job. syntax_tree reprints: it
  discards the input's line breaking and decides it again, which is what makes
  formatting idempotent and input-independent. RuboCop never reprints — measured
  on 116 files whose formatting differed only in line breaking, RuboCop alone
  brought 0 of them to a common result, and syntax_tree brought 91. But
  syntax_tree's output is not clean, which is what RuboCop is here to fix. The
  order is fixed: running syntax_tree afterwards would revert RuboCop in 116 of
  397 files.

  The RuboCop half is exactly `rubocop --autocorrect --only Layout`, asserted
  byte-identical against `RuboCop::CLI` with the gem versions pinned.

  Two options come with it. `rubocopConfig` takes extra `.rubocop.yml` entries,
  merged over the ones this package sets — the escape hatch for the rest of
  RuboCop's configuration. And `init({ rubocop: false })` lets a synchronous
  caller leave RuboCop unloaded, which `formatSync` otherwise could not do because
  it requires `init`.

  `Layout/LineLength` is off, because `printWidth` belongs to syntax_tree: it is
  the tool that reprints, so it is the one that can honour a width. With the cop
  on at its default `Max: 120`, `{ printWidth: 200 }` came back rewrapped at 124 —
  neither width. Disabling it changes none of 397 corpus files at the default
  width; `rubocopConfig` puts it back for anyone who wants it.

  Costs: the artifact grows 3.8 MB → 5.1 MB (RuboCop 1.74.0 and its dependencies
  alongside syntax_tree 6.3.0), which every consumer pays. Loading RuboCop into
  the VM takes about four seconds on the first call — or during `init`, which now
  covers it so `formatSync` does not stall — and each format after that costs two
  to three times what syntax_tree alone does. `{ rubocop: false }` skips all of
  it: RuboCop is then never loaded.

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

### Patch Changes

- 248c1ca: Copy artifact views into a standalone byte window before compiling them.

## 0.2.1

### Patch Changes

- 883f3d0: Recycle the wasm VM at 400MB of linear memory rather than 1.1GB. A recycle
  cannot hand back the outgoing VM's memory synchronously, so the process holds
  the old buffer and its replacement at once; at the old ceiling that pair peaked
  at ~1.5GB resident, which is a lot to ask of a CI runner formatting a codebase.
  The lower ceiling holds the peak near 1GB and costs about one extra ~250ms boot
  per 130KB of input.

## 0.2.0

### Minor Changes

- 22817a7: Stop returning Ruby that does not parse.

  `then` is mandatory in a `case`/`in` clause whose pattern ends in an endless
  range, and syntax*tree 6.3.0 only keeps it when the \_whole* pattern is one. So
  `in 300.. | 400.. then` came back as `in 300.. | 400..`, and
  `in { status: 400.. } then` as `in status: 400..` — a syntax error, out of
  source that parsed on the way in, with nothing raised. The first sign was a
  generated SDK that no longer compiled.

  `format()` now keeps the `then`, deciding on the rendered pattern rather than on
  its node types, so a literal like `in { m: "ends.." }` is not mistaken for a
  range. The patch is applied to the gem at boot rather than baked into the
  artifact, which stays stock syntax_tree 6.3.0, and it goes away when the fix
  lands upstream. Formatting the rubocop, rubocop-ast and syntax_tree gems both
  ways — 1,033 files — it changes the output of none of them, and
  `test/native-conformance.test.ts` now pins the divergence in both directions.

  `format()` also parses everything it returns and raises rather than handing back
  source Ruby cannot read, so the next bug of this shape cannot corrupt a file
  quietly. It costs about 2.7ms on a 28ms format.
