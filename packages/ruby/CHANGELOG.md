# @scalar/ruby-fmt

## 0.6.0

### Minor Changes

- 8e273e1: The wasm artifact now ships a Ruby VM that has already booted, with syntax_tree and RuboCop loaded into it. `build/ruby_fmt/build.sh` runs [wizer](https://github.com/bytecodealliance/wizer) over the module and serializes the initialized linear memory back into it, so a consumer instantiates a VM that is up rather than one that has to require 698 cop files first. The first `format` call in a fresh process drops from 11.1 s to 2.1 s, and a VM recycle from 6.3 s to 0.5 s — the recycle being the one that compounds, since formatting's linear-memory leak forces it repeatedly in any process that formats a whole tree. Output is byte-identical: the same gems, on the same CRuby, doing the same work in a different order.

  The trade is install size. The artifact goes from 5.2 MB to 12.2 MB compressed (37 MB to 67 MB expanded), because a Ruby heap with RuboCop in it is now part of the module. That is the whole cost, and it is paid once at install rather than repeatedly at runtime.

  **Breaking:** `init` no longer takes a `rubocop` option, and the `InitFormatOptions` type is gone with it. It existed to decline the ~9 s `init` spent requiring RuboCop, and RuboCop now arrives already required, so there was nothing left for it to do. Drop the argument — `await init()` — and, in the browser build, pass `InitOptions` (`url`, `bytes`, `encoding`) directly. `init` now matches every other package in the repo. `format(source, { rubocop: false })` and `formatSync(source, { rubocop: false })` are unaffected: they skip the Layout pass, which is the part that was ever worth skipping per call.

### Patch Changes

- b51c9a5: Comment-only change inside the package: `node-vm.ts` now records that the benchmark harness reads the same shared VM the formatter and the recycling test do. No behaviour change, and no change to formatted output.

  The harness itself is repo tooling, `bun run ruby:bench`. It measures cold start split into artifact compile, VM boot and first format; the cost of one VM recycle, timed against a VM grown past the ceiling `format()` actually recycles at; and a whole-corpus run reporting format time, ms/KB and recycle count. Each measurement runs in its own process, because booting is once per process and formatting leaks the VM's linear memory, so anything measured second is measured against a VM the first thing already degraded.

  Corpus runs can write a hash per formatted file, and `--compare` diffs two of those snapshots — which is how a rebuilt wasm artifact answers "the output did not change".

## 0.5.0

### Minor Changes

- f316f85: The bundled RuboCop moves from 1.74.0 to 1.81.6, and the CRuby it runs on from
  3.4.1 to 4.0.0.

  **This changes output**, in the direction of fewer Layout offenses left behind.
  Two of them are offenses syntax_tree's own output introduces, so the
  `--only Layout` pass was always the thing that should have been clearing them,
  and 1.74.0 simply did not:

  - `Layout/SpaceInsideHashLiteralBraces` now applies to hash _patterns_, not only
    hash literals. `in { event: "error", data: String => data }` was left
    untouched by an `EnforcedStyle: no_space` config that corrected the identical
    literal.
  - `Layout/SpaceAroundKeyword` now flags the `return(` that syntax_tree emits
    when a `return <call>` has to wrap, so it comes back as `return (`.

  The CRuby bump is the price of the RuboCop bump rather than a separate change.
  RuboCop 1.75 and later need `rubocop-ast` 1.43+, which subclasses prism's parser
  translation while it is being required — prism has to exist before the first cop
  is registered, whether or not the pass ever parses with it. That translation
  needs prism 1.4, and `rubocop-ast` 1.49 raised the floor again to 1.7. A prism
  gem cannot supply it, because a static wasm build resolves `require
"prism/prism"` from the built-in extension table before `$LOAD_PATH`. Ruby 3.4.1
  compiles in prism 1.2.0; Ruby 4.0.0 compiles in 1.7.0.

  syntax_tree stays at 6.3.0 and its output is unaffected by the newer Ruby:
  formatting 1,200 files of real Ruby through syntax_tree 6.3.0 on 3.x and on
  4.0.0 gives byte-identical results, which is the property the "exact" claim
  rests on. `TargetRubyVersion` for the RuboCop pass is unchanged at 3.4 — it
  describes the Ruby a consumer is writing for, not the one inside the artifact.

  Two things inside the VM had to move with the Ruby. RubyGems is now required
  explicitly, because Ruby 4.0 stopped loading it during startup and syntax_tree
  reaches for `Gem::Version` on the second line of its formatter. And the VM
  registers a minimal gemspec for each gem in `/bundle` before requiring RuboCop,
  because rbwasm packages the bundle as `$LOAD_PATH` entries with no
  specifications at all — with none to find, prism's parser translation answers
  its own `gem "parser", ">= 3.3.7.2"` with `exit(1)`.

  The artifact grows 5.1 MB → 5.2 MB: a larger CRuby, and prism's Ruby files,
  which the build used to strip because nothing loaded them.

  CI now installs Ruby 4.0 so that both conformance tests keep comparing against
  the same versions the artifact carries.

### Patch Changes

- f316f85: Fixes three syntax_tree 6.3.0 pattern-matching bugs that made `format` reject
  whole files.

  All three produce Ruby that does not parse from input that did, so the re-parse
  guard `format` runs was throwing rather than writing a broken file. The guard
  was right; the fixes are what was missing. They live in `src/stree-patch.ts`
  alongside the endless-range fix that was already there, applied by reopening the
  classes at boot, so the artifact stays stock syntax_tree 6.3.0.

  **A guarded clause lost the parentheses that make it legal.** `in (400..) if g`
  came back as `in 400 ..  if g` — `unexpected 'if', expecting 'then'`. The
  parentheses are the only legal spelling here, because the guard already occupies
  the place `then` would go, and syntax_tree recorded no trace of them. Writing
  `then` defensively in the input did not survive either. A guarded pattern that
  does not terminate itself is now wrapped back in parentheses, and a hash pattern
  inside them keeps its braces — `in {x: (500..)} if g` comes back as
  `in ({ x: 500.. }) if g`, since `in (x: 500..)` does not parse.

  **` then` was printed inside a hash pattern's braces.** `in {a: 1, **}` came
  back as `in { a: 1, ** then }` — `unexpected 'then', expecting '}'`. The braces
  already do the job that `then` was there for, so it is now printed only in the
  one rendering that has none, `in ** then`.

  **An exponent earlier in the file was adopted as a hash pattern's `**`.** A
`n**2`anywhere above a`case`/`in`left an`Op`token that the pattern's
unbounded reverse search claimed as its own, so`in {a: 1, b: 2}`came back as`in { a: 1, b: 2, ** then }`. The search now has a floor: the pattern's own `**`
is the last thing in it, so it must start after the pattern's constant, keywords
and opening brace. That refuses a pin expression's exponent too
(`in { a: ^(n**2), b: 2 }`). One shape in this family parsed and meant something
else — `in {}`after an exponent became`in \*\*`, which matches any hash rather
  than only an empty one.

  Spacing the exponent as `n ** 2` used to dodge this, but syntax_tree normalises
  it straight back to `n**2`, so the workaround did not survive a second run.
  Nothing else changes: over 2,076 files of real Ruby the fixes alter the output
  of none of them.

  Also documents a hazard that is not this package's bug: RuboCop's
  `Style/MultilineInPatternThen` removes the `then` that a pattern ending in an
  endless range cannot do without, and the result does not parse. The Layout pass
  here never runs it, but a consumer running a full `rubocop -a` afterwards
  should turn that cop off. See the package README.

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
