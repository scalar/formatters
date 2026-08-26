# Architecture

## Overview

`formatters` provides code formatters — Ruby, Java, C#, Swift, PHP and Rust —
under one hard constraint: **formatting must work with nothing installed but
Node.** No Ruby install, no gems, no JVM, no .NET SDK, no Swift toolchain, no PHP
or Composer, no Rust toolchain, no native binaries, no postinstall downloads. The approach follows the
[`@wasm-fmt`](https://github.com/wasm-fmt) packages: ship the real formatter
compiled to WebAssembly rather than a reimplementation of it.

The PHP package is the one that ships a tool it did not compile, because PHP CS
Fixer is pure PHP and a maintained wasm PHP already exists — the released phar
*is* the reference tool, so compiling anything would only add drift.

Bun is the development toolchain — package manager, test runner, script runner.
It is never a runtime requirement of a published package. `bun run test:node`
loads each package under plain Node so the constraint is enforced, not assumed.

Ruby, Java, Kotlin, C#, Swift and Rust also run in a browser, behind a `browser`
export condition. PHP has no browser entry. That is an addition to the Node
constraint, never a relaxation of it: the Node entry stays the default and stays
free of anything a browser needs. `bun run test:browser` enforces the browser
half the same way `test:node` enforces the Node half, in real Chromium against
the built `dist`.

## The browser split

A package that runs in both places has exactly one environment-dependent
question — where do the wasm bytes come from — and the structure exists to keep
it to that one question.

```
src/
  format.ts              createFormat(source) — the whole formatter, environment-free
  boot-module.ts         createBootModule(source) — instantiation, environment-free
  compile-artifact.ts    Node: fs + zlib
  fetch-artifact.ts      browser: fetch + DecompressionStream
  decompress-brotli.ts   browser: native brotli, or a lazily imported wasm decoder
  index.ts               Node entry: createFormat(compileArtifact)
  index.browser.ts       browser entry: createFormat(fetched) + init
```

Each package exports `format`, `formatSync` and `init`. Booting is the only
asynchronous step there has ever been - fetching or reading the wasm, and
compiling it - so `formatSync` is the same code `format` runs after its await,
guarded by a `peek()` that answers "is it booted" without one. Two limits shape
it, both measured rather than assumed: a browser main thread refuses both
`WebAssembly.Module` and `WebAssembly.Instance` above 8MB, so booting always uses
async `WebAssembly.instantiate` and only trap recovery tries the synchronous
form; and Ruby cannot recycle synchronously at all, because
`RubyVM.instantiateModule` is async, so its `formatSync` refuses past a memory
ceiling and asks for another `init`.

`format.ts` and `boot-module.ts` are factories over an artifact source rather
than importers of one. That is what lets both entry points share a single
implementation while the browser build never mentions `node:fs` — a bundler that
followed a `node:` import here would fail loudly, and a bundler that shimmed it
would fail quietly, which is worse.

Compression stays brotli on both sides. The artifact is committed once, and the
browser reads that same file; a gzip twin sized for browsers without native
brotli would cost 41–59% more over the wire *and* double what every Node install
carries for a file it never opens. The 208KB wasm decoder covers engines without
`DecompressionStream('brotli')` — Chrome, as of 141 — and is dynamically imported
so no Node process resolves it and no capable browser fetches it. `init` lets a
caller who serves the artifact themselves skip it entirely.

C# fits the same shape with one wrinkle: its assets are not all bytes. The .NET
runtime imports four `runtime/*.js` files as ES modules by URL, so those cannot
be handed over the way the assemblies are. Its resource loader answers those by
returning a URL string rather than a `Response` — the runtime accepts either —
and the URLs come from four *static* `new URL(name, import.meta.url)` literals.
Static matters: a bundler only rewrites the form it can read at build time, so
one literal per file is the difference between the assets being emitted and the
consumer being told to copy them. Verified against a real Vite build, which
emits all four hashed and still boots.

One caveat that applies everywhere: Vite, Rollup and webpack rewrite
`new URL(..., import.meta.url)`; esbuild does not. `init` is the escape hatch,
and the reason every browser entry has one.

## Repo structure

```
build/                  build pipelines for wasm artifacts
packages/               published npm packages, one per language
  <pkg>/src/            TypeScript sources, one function per file
  <pkg>/dist/           compiled output — what consumers import (gitignored)
  <pkg>/test/           integration tests and the plain-Node smoke test
scripts/                repo tooling
tsconfig.json           strict base config, shared by every package
tsconfig.build.json     the same, in emit mode
tsconfig.scripts.json   covers scripts/ and the build pipelines' scripts
tsconfig.node-smoke.json  the smoke tests, checked against built dist
```

Each `packages/*` directory is an independently published package with its own
README explaining exactly what it is and what it is not.

Packages are written in TypeScript and publish `dist`, so declarations are
generated from the source rather than hand-maintained beside it. A package's
`tsconfig.json` extends the root one and type-checks `src` and `test`; its
`tsconfig.build.json` adds `rootDir`/`outDir` and drops the tests. The build is
`tsc` followed by `tsc-alias -f`, which rewrites the extensionless relative
imports in the emitted JavaScript to the full specifiers Node's ESM resolver
requires.

`packages/*/test/node-smoke.ts` imports `dist` rather than `src`, because its
whole job is to exercise what a consumer actually gets. It runs under `node`,
not bun, and no build step turns it into JavaScript first — Node strips the
types itself, unflagged since 22.18 and 23.6, so `node --test` really is running
that file directly.

Because it resolves `dist/index.d.ts`, type-checking it asserts the *emitted*
public API against a real caller — worth having, but it needs a build. So it is
excluded from each package's `tsconfig.json` and checked by the root
`tsconfig.node-smoke.json` instead, which `test:node` runs after building. That
keeps `bun run types:check` working on a fresh clone.

The repo tooling in `scripts/` and the build pipelines' diagnostic scripts sit in
no package, so `tsconfig.scripts.json` covers them and `types:check` runs it
first. Its `include` lists directories rather than globbing `build/**`, because
each pipeline downloads a toolchain into a gitignored subdirectory and a glob
would pull whatever TypeScript those contain into the project.

Three JavaScript files are not ours to convert and must stay as they are:
`packages/csharp/runtime/*.js` and `packages/{java,kotlin}/*_fmt.runtime.mjs`
are generated by the .NET and TeaVM toolchains and shipped verbatim, and
`build/csharp_fmt/main.mjs` is the csproj's `WasmMainJSPath`, which the .NET SDK
requires to be JavaScript.

## The exactness rule

This is the design principle everything else follows from.

A package is **exact** only when it *is* the reference formatter compiled to
wasm. A reimplementation — however careful, however close on the samples you
happened to test — is not exact, because a formatter's line-breaking heuristics
are emergent from its implementation rather than specified anywhere. The drift
is invisible until a consumer's CI runs the real tool in `--check` mode and
fails.

So every package states its reference tool by name, and every non-exact package
documents what diverges. Upgrading a status to exact requires a conformance test
that asserts byte-identical output against the real tool, not a test that
reports similarity.

The conformance test for an exact package **asserts**
(`packages/ruby/test/native-conformance.test.ts`): the package *is* the
reference tool, so any divergence is a real bug and it fails the build. A
non-exact package gets a **reporting** test instead — one that prints the
divergence rather than failing on it, so a dependency bump cannot grow the gap
silently. Either shape skips cleanly when the native tool is absent, so a
toolchain-free checkout still passes.

## Packages

### `@scalar/ruby-fmt` (`packages/ruby`)

Reference: **syntax_tree + RuboCop**. Status: exact.

Runs actual CRuby compiled to WebAssembly with the actual syntax_tree gem loaded
into it. It works because syntax_tree and prettier_print are pure Ruby whose only
C dependency is Ripper, which is already inside CRuby's stdlib.

`format()` is async because the first call decompresses and compiles the
artifact and instantiates a Ruby VM from it; the VM is cached, so later calls
are milliseconds.

**The artifact is a wizer snapshot of an already-booted VM.** `build.sh` runs
[wizer](https://github.com/bytecodealliance/wizer) over the module - see
`build/ruby_fmt/preinit.ts`, which is where every non-obvious part of that step
is written down - so the linear memory it ships *is* a CRuby with syntax_tree
and RuboCop required into it. Booting used to cost ~8 s of Ruby and to cost it
again after every VM recycle, which was about a fifth of the wall-clock of
formatting a large tree. Three things follow, and none of them is optional:

- `boot-vm.ts` does not call `RubyVM.instantiateModule`, because that helper
  ends by calling `ruby-init` - which the snapshot has already been through.
  Re-running it would reinitialise CRuby underneath the loaded gems.
- The preopened directories the snapshot is taken with have to match the ones
  the runtime provides, name for name. The guest's preopen table is captured in
  the snapshot, so a mismatch is a VM that cannot see `/work` at all and dies on
  the first RuboCop call with `Errno::ENOENT @ dir_s_mkdir`.
- It costs size: 12.7 MB compressed against 5.4 MB, because a Ruby heap with
  RuboCop in it is part of the module now. That is the trade, and the size table
  in the root README states it.

**Two tools, one artifact, both by default.** `format` runs syntax_tree and then
the real `rubocop --autocorrect --only Layout`. Neither subsumes the other:
syntax_tree reprints (it discards the input's line breaking and decides it
again) but about 30% of its output still trips stock `rubocop --only Layout`,
while RuboCop corrects offenses without ever reprinting - measured on 116 files
whose formatting differed only in line breaking, RuboCop alone mapped 0 of them
to a common result and syntax_tree mapped 91. They share one artifact so that a
process does not carry two copies of CRuby, and `src/rubocop.ts` documents which
of RuboCop's own parts drive the correction and which are deliberately left out.

Order decides the result, because the two disagree about multiline indentation:
syntax_tree first, RuboCop second. Running syntax_tree afterwards would revert
RuboCop in 116 of 397 files.

`rubocop: false` opts out, and then RuboCop is never required into the VM at all
- worth about four seconds on the first call. `init` does load it, because it is
the default pass and `formatSync` would otherwise stall for those seconds in a
caller that chose the synchronous entry point precisely because it cannot wait;
`init({ rubocop: false })` is how such a caller declines, and the only way,
since `formatSync` cannot run without `init`.

**syntax_tree owns line width.** `Layout/LineLength` is disabled in the config
written into the guest, because it is the one Layout cop that contradicts
`printWidth` - with it on at RuboCop's default `Max: 120`, `printWidth: 200`
came back rewrapped at 124. Disabling it changes none of 397 corpus files at the
default width. `rubocopConfig` merges over that config one level deep, which is
both the escape hatch for the rest of RuboCop's settings and the way to put that
cop back.

The gem pins in `build/ruby_fmt/Gemfile` are load-bearing beyond
reproducibility, and they are what fixes the CRuby the artifact is built on.
`rubocop-ast` subclasses prism's parser translation while it is being required,
so prism has to be loadable before any cop is registered - 1.43.0 needs prism
~> 1.4 and 1.49.0 needs ~> 1.7. A prism *gem* cannot supply that, because a
static wasm build resolves `require "prism/prism"` from the built-in extension
table before `$LOAD_PATH`, so whatever CRuby compiles in is what runs. Ruby
3.4.1 compiles in 1.2.0 and Ruby 4.0.0 compiles in 1.7.0, which is why the
RuboCop pin and the `RUBY_VERSION` in `build.sh` move together.

**WASI comes from `@bjorn3/browser_wasi_shim`, not `node:wasi`,** even though the
package only ever runs on Node. The interfaces are compatible —
`RubyVM.instantiateModule` wants `{ wasiImport, initialize }` and Node's WASI has
both — but Node's implementation segfaults non-deterministically once ruby.wasm
is given preopened directories, and a preopen is how the input file reaches
Ruby. Measured at 2 failures in 6 runs on identical input, killing the process
with SIGSEGV rather than throwing. The shim is also pure JavaScript with an
in-memory filesystem, so the source being formatted never touches disk. Do not
"simplify" this dependency away.

**Known bug — the cached VM leaks.** Each format grows the VM's wasm linear
memory (roughly 74 MB per 23 KB of input) and never releases it. Ruby's own
object heap stays flat, so this is not a Ruby-level leak. At 2 GB a guest
pointer read as a signed i32 goes negative and the JS glue throws
`RangeError: Start offset -… is outside the bounds of the buffer`. The practical
ceiling is about 680 KB of cumulative input per process. Anything that formats a
whole codebase in one process must recycle the VM.

### `@scalar/java-fmt` (`packages/java`)

Reference: **google-java-format**. Status: exact.

Runs actual google-java-format 1.36.1, javac's own parser included, compiled to
WasmGC by **TeaVM**. `format()` is async because the first call decompresses and
compiles the module; the module is cached, so later calls are milliseconds.

**There are two build pipelines, and the shipped artifact is the TeaVM one.**
`build/java_fmt/build.sh` (GraalVM Web Image) came first and still works;
`build/java_fmt_teavm/build.sh` replaced it as the source of the published
bytes. Both are exact — they produce byte-identical output to the native CLI on
a 658-file corpus, and to each other — so the difference is entirely licensing.
The Web Image artifact embeds Oracle code under the GFTC, which permits
redistribution only where no fee is charged for the artifact or for anything
bundling it; the TeaVM artifact's only non-permissive component is javac's
parser, GPLv2 **with the Classpath Exception**, which explicitly permits linking
into a product distributed under terms of your choice. Keep the Web Image
pipeline: it is permitted for internal and hosted use, it is the *unpatched*
reference, and running the corpus through both is evidence neither one alone
provides.

**The TeaVM build is a fork of three projects, not a toolchain flag.** It
compiles a patched TeaVM from source, patches google-java-format's sources, and
supplies stub classes for JDK internals. Details are in the package README; the
shape to keep in mind is that the patches live in
`build/java_fmt_teavm/patches/` as diffs against pinned upstream checkouts, so
each one is reviewable and can be dropped as it lands upstream.

**The six patched google-java-format sites are version probes, and the build
proves it.** Each reflects into javac to cope with a JDK version difference, and
each has one answer on the pinned JDK 21. Before any wasm is built, the same
corpus is formatted on a plain JVM by the stock jar and by the patched one:
658/658 identical. That is what lets the exactness claim survive the patches —
the conformance test then compares the wasm against the *stock* jar, never the
patched one.

**Node 24.15, not 22 and not 24.0.** Node 22 has WasmGC and formats correctly,
but V8's wasm optimizer grows without bound on this module (~100MB/s) until the
process is killed, so a process that formatted anything would never exit. V8 13
does not, and neither does JavaScriptCore, so bun is unaffected. The minor is a
second, unrelated thing: TeaVM emits the final wasm exception-handling proposal
(`try_table`, opcode 0x1f, over `exnref`), which V8 takes on Node 22, rejects at
compile time on 24.0 through 24.14, and takes again from 24.15.0.
`boot-module.ts` checks for both and throws; the Node smoke test skips with the
reason rather than hanging. The opcode check is a feature probe — a 28-byte
module it tries to compile — because bun reports a Node version below the floor
and runs the artifact fine, so a version comparison would be wrong there.

That floor is why CI pins Node by exact version. `node-version: 24` is not a
pin: setup-node serves it from the runner image's tool cache, so the job gets
whichever 24.x the image ships, and an image predating 24.15.0 fails both
packages at compile time.

**`format()` replicates the CLI pipeline, not `Formatter.formatSource`.** The
tool runs four steps — format, `RemoveUnusedImports`, `ImportOrderer`,
`StringWrapper` — and the last three are on by default. Wrapping only
`formatSource` leaves imports untouched and text blocks unreflowed, which is a
real divergence from the named reference. Keep the order: it is
`FormatFileCallable`'s.

**The generated runtime ships with the wasm and is not optional.** Neither
backend emits a standalone module — both depend on JavaScript-provided imports,
so neither can run under `wasmtime` and there is no `.wasm`-only version of the
package. TeaVM's runtime is an ES module exporting `load`, so it is imported
directly; Web Image's was CommonJS and had to be `.cjs` because it read
`__filename`.

**Hand `load` the bytes, never a path.** Given a path, TeaVM's runtime reads the
file through `fs.promises.open` and a web stream, which leaves a handle Node
counts as live — a process that formatted anything would then never exit. The
package decompresses the artifact itself and passes the buffer.

**No `wasm-opt` pass.** Binaryen 123 rewrites TeaVM's exception handling into a
form V8 rejects (`type error in branch[0] (expected (ref exn), got exnref)`) at
every optimisation level. Fix problems in the compiler, not in the bytes.

**The module has no filesystem and no stdin.** Source crosses as a string in
both directions, and failures cross as a status-prefixed string, because a Java
exception reaching JavaScript arrives as a proxy object with no readable
message.

**Notes that belong to the Web Image pipeline**, which still lives in
`build/java_fmt/build.sh`: it needs Oracle GraalVM, because `--tool:svm-wasm`
ships only there — Community Edition answers `Unknown name in option
specification`. And `--initialize-at-build-time=…java.Trees` in it is not an
optimisation: `Trees`' class initializer looks up a `VarHandle` through a `Class`
resolved at run time, the analysis cannot fold it, and the generic
`VarHandles.makeFieldHandle` drags in accessors for every primitive type — whose
`float`/`double` compare-and-set crashes the WasmGC backend. Do not remove it to
"clean up" the flag list.

### `@scalar/kotlin-fmt` (`packages/kotlin`)

Reference: **ktfmt**. Status: exact.

Runs actual ktfmt 0.64 with the Kotlin compiler's own PSI parser, compiled to
WasmGC by the same TeaVM fork the Java package uses. Built by
`build/java_fmt_teavm/kotlin-probe/build.sh`; the directory is named for the
feasibility probe it started as.

**The exactness claim is two measurements, not one,** because output could change
in two places. `gate2.sh` asks whether the one patched ktfmt file changes its
output on a JVM; `conformance.sh` asks whether compiling that to wasm changes it.
Same 589 files from kotlin-stdlib, kotlinx-coroutines and ktfmt itself, three
styles, **1767/1767 byte-identical each**, failures encoded the same on both
sides so a reworded diagnostic would count. Together they chain from stock ktfmt
to this module.

**ktfmt as shipped does not compile, and the reason is narrower than it looks.**
Pointing TeaVM at `Formatter.format` reports 94 missing members — StAX,
`ZipFile`, `Runtime.exec`, `ForkJoinPool`, AWT and Swing. That is
`KotlinCoreEnvironment`, the compiler's *CLI environment*, which resolves a
classpath and instantiates extension points named by string in
`META-INF/extensions/compiler.xml`. Parsing needs none of it: a bare
`CoreApplicationEnvironment` with `KotlinParserDefinition` registered drops the
frontier to 40 and takes all of that with it. `patches/ktfmt.patch` is that swap,
20 lines of one file, and `gate2.sh` is the evidence it changes nothing.

**TeaVM resolves reflection statically,** so `Class.forName`,
`getDeclaredField`, `getConstructor` and `Proxy` all need telling at build time.
`kotlin-probe/plugin/` is that: a build-time TeaVM extension, never compiled to
wasm. Scope its rules by the mechanism that needs them, not by package — a
reflectable member is a dependency root, so a package-wide rule made every class
in `com.intellij` reachable and failed to compile at all.

**One `Thread.yield()` cost a third of the module.** `AsyncMethodFinder`
propagates async-ness from every `@Async` method to its callers over a call graph
that keeps exception-construction and virtual `toString` edges, so one reachable
`Thread.yield()` in kotlinx-coroutines made 7,055 of 20,513 methods coroutines —
including the `stringToJs` the module initializer calls, whose coroutine prologue
dereferences a fiber that does not exist yet, so the module trapped at
instantiation. Cutting one root does nothing: removing `yield` moved all 7,055 to
`Thread.sleep`. The fork's single-threaded stand-ins leave none reachable.

**Licensing is unrestricted,** unlike the Java package. ktfmt reads Kotlin with
the Kotlin compiler's PSI and uses google-java-format only for its layout engine,
so javac is not in this module and there is no GPL component; everything embedded
is Apache-2.0.

### `@scalar/csharp-fmt` (`packages/csharp`)

Reference: **CSharpier**. Status: exact.

Runs actual CSharpier 1.3.0, Roslyn's own C# parser included, compiled to wasm
by the .NET 10 `browser-wasm` toolchain — the same Mono-on-wasm runtime Blazor
uses, reached through the `wasmconsole` template, which targets Node rather than
a browser. It works because CSharpier's whole formatting surface for a `.cs`
file is one static string-in/string-out call with no I/O behind it.

`format()` is async because the first call decompresses the archive and boots
the runtime; the module is cached, so later calls are milliseconds.

**`dotnet format` was never the target.** It is a whitespace fixer that runs
over an MSBuild workspace and wants a `.csproj`, a restored dependency graph and
an `.editorconfig`, none of which exist inside a module with no filesystem.
CSharpier parses and re-prints from scratch, which is the shape that compiles.

**WASI is a dead end for .NET.** The `wasi-experimental` workload has been
broken for over a year and .NET 10 shipped without WASI support, so
`browser-wasm` is the only live route. It also gives a better boundary than the
Java package has: `[JSExport]` marshals `int`/`bool`/`string` natively, so
options cross as real arguments rather than an encoded spec string.

**`InvariantGlobalization=true` reorders using directives.** It is the obvious
size knob for a wasm build and it is wrong here. CSharpier orders usings with
`StringComparison.InvariantCultureIgnoreCase`, a linguistic comparison; without
ICU, .NET degrades that to ordinal and `using SomeCompany._Word;` sorts *after*
`MWord`. Two files in the conformance corpus caught it. ICU costs ~0.8MB and is
not optional — `format.test.ts` guards it with a sorting case.

**`Diagnostic.ToString()` traps the AOT build.** It dies with "null function or
function signature mismatch", a known Mono wasm AOT problem with generic virtual
dispatch. A probe build established that `Id`, `GetMessage()` and the line span
are all fine, so `CSharpFmt.cs` assembles the same text from those instead of
giving up AOT — which is worth keeping, because it is 4x on every format.

**`TrimMode=full` is safe here, but only checkable by running.** Roslyn and
CSharpier both emit `IL2104` trim warnings, so the linker's own signal is "maybe
broken". The 613-file corpus is what proves it is not. Do not change trimming
without re-running it.

**The artifact is split in two, and the split is forced.** The four `.js` files
are ES modules the runtime imports by URL, so they must be real files.
Everything else is fetched through `dotnet.withResourceLoader`, which accepts a
`Response`, so 21MB of assemblies and ICU data ships as one 4.2MB brotli
archive. That hook is why this package needs no equivalent of the Java
package's `fs.promises.readFile` interception.

**`WasmSingleFileBundle` does not work.** It fails on Linux with
`EmitBundleObjectFiles` dying on a broken pipe, which is why the archive is
packed by hand in `build/csharp_fmt/build.sh`.

### `@scalar/swift-fmt` (`packages/swift`)

Reference: **swift-format**. Status: exact.

Runs actual swift-format 603.0.0 — the release that pairs with Swift 6.3 — with
swift-syntax's real parser, compiled by the official Swift SDK for WebAssembly
from swift.org. Not the SwiftWasm fork, and not a reimplementation.

`format()` is async because the first call decompresses and boots the module;
the module is cached, so later calls are ~30ms.

**The CLI cannot be compiled; the library can.** swift-format's executable
target imports Dispatch and the WASI SDK ships no libdispatch, so
`build/swift_fmt/Sources/swift_fmt/format.swift` wraps the `SwiftFormat`
library instead. That is a small gap: `swift-format format <file>` resolves a
configuration and then calls exactly one method,
`SwiftFormatter.format(source:assumingFileURL:selection:to:)`, with no further
pipeline steps — unlike google-java-format, whose CLI runs three more passes.
The only behaviour left out is `.swift-format` discovery, because there is no
filesystem to search; the host passes the resolved configuration in.

**Configuration crosses as JSON and is decoded by the real `Configuration`
type,** whose `init(from:)` is `decodeIfPresent ?? default` throughout. So
absent keys take swift-format's own defaults and this repo holds no second copy
of them.

**The module is a WASI reactor, and it does not leak.** It is instantiated once
and `run` is called per format: 2.5x faster than a fresh instance per call
(31ms vs 79ms per file over 442 files), byte-identical output either way, and
linear memory that goes 54MB at boot to 75MB after a hundred files and then
stays there through 7.2MB of cumulative input. Nothing like the Ruby VM's leak,
so there is no recycling to do — except after a trap, which leaves the Swift
runtime mid-call and so drops the cached instance.

**Nothing may go in `main.swift`.** Under `-mexec-model=reactor` `main` is never
called, so top-level code never runs and file-scope declarations in that file
are never initialised. They do not error: integer constants read as 0 and
strings read as empty, so every status code the wrapper returned came back as
"success" while no output was ever written. The implementation lives in
`format.swift`, where globals initialise lazily on first access like any other
Swift global.

**Two build flags are load-bearing.** `-z stack-size=16777216`, because the
default wasm stack overflows on ordinary Swift — swift-syntax's own
`UnicodeScalarExtensions.swift` is 10KB and chains ~70 `||` operators into one
expression, and walking a tree that deep traps with `memory access out of
bounds`. And the SDK must be named by **id** (`swift-6.3.3-RELEASE_wasm`), not
by triple: the normal and embedded SDKs both declare `wasm32-unknown-wasip1`,
and the ambiguity resolves to the embedded one, which fails deep inside
swift-syntax with "unavailable in embedded Swift".

**It is 13MB, and that is mostly swift-syntax.** Three times the other
packages. `-Osize` and `wasm-opt -Oz` were both tried and neither moved the
compressed size by more than 50KB.

**Licensing is unrestricted,** unlike the Java package: swift-format, the Swift
standard library and Foundation are all Apache-2.0 with the Runtime Library
Exception, so a paid product may ship a copy.

### `@scalar/php-fmt` (`packages/php`)

Reference: **PHP CS Fixer**. Status: exact.

Runs the official php-cs-fixer 3.95.18 phar, unmodified, on actual PHP 8.4
compiled to WebAssembly. It works because PHP CS Fixer is pure PHP and a
maintained wasm PHP already exists, so there is nothing to compile.

`format()` is async because the first call decompresses the phar and boots PHP;
the instance is cached, so later calls are ~290ms.

**Nothing is compiled here, and that is deliberate.** Every other package
compiles its reference tool because no wasm build of it exists. The released
phar *is* PHP CS Fixer, so `build/php_fmt/build.sh` downloads the pinned
release, sanity-checks the stub and signature marker, and brotli-compresses it
(3.5MB → 0.44MB committed). Building from source would only add a copy that
could drift from the release, which is the exactness rule pointed at ourselves.

**The runtime is a dependency, not part of the artifact.** PHP comes from
`@php-wasm/node-8-4`, which is what pins the PHP version. Do not "simplify" this
to the `@php-wasm/node` meta-package it sits under: that one depends on
`fs-ext-extra-prebuilt`, which ships prebuilt `.node` binaries and runs an
install script — the exact two things this repo exists to avoid — and on every
PHP from 7.4 to 8.5, turning a 66MB install into 463MB. Its file locking and
WebSocket networking also hold Node's event loop open, so a process that formats
a file and returns never exits.

**`format()` drives the `fix` command in-process, not by executing the phar.**
PHP's CLI SAPI is one-shot: the first `php.cli()` call on a runtime works and
every one after it silently does nothing, handing back unformatted input with a
zero exit code. Rotating to a fresh runtime per format works but costs ~900ms
against ~290ms. The embed SAPI reached through `php.run()` is reusable and,
unlike the Ruby VM, does not leak memory. It drives the `Application`'s `fix`
command rather than assembling a `Runner`, because the pipeline around the
fixers is part of what the tool is and `Runner`'s constructor changes between
minor versions while the command's does not.

**Known bug, worked around — the descriptor leak.** `Config`'s constructor calls
`ParallelConfigFactory::detect()`, whose CPU-core finders shell out through
`proc_open`. There are no subprocesses in wasm, so each attempt failed and
leaked the pipes it opened, and `FixCommand` builds a `Config` on every format
whatever the input. After ~100 formats the guest descriptor table filled and the
runtime trapped, after which every call failed with `File descriptor value too
large` — an error naming nothing to do with the cause. `boot-php.ts` sets
`disable_functions` so the finders fail before opening anything; detection falls
through to its own fallback and reports one core, which a single-file format
wants anyway. `test/descriptor-leak.test.ts` holds the line at 150 consecutive
formats. Do not remove that ini setting.

**Caller options never become PHP source.** Rules, indent and line ending travel
as JSON through `/work/config.json` and are read with `json_decode`; the two PHP
driver scripts are written once at boot and interpolate only this package's own
path constants. Rules are arbitrary nested structures, and a rule name built
into PHP source could close the literal it sits in.

**Unparseable input throws.** PHP CS Fixer skips a file it cannot parse and still
exits zero, which would hand the caller their own input back and call it
formatted. The driver checks with the same `token_get_all($source, TOKEN_PARSE)`
the tool's own linter uses.

**Configuration discovery is missing**, as with Swift: the tool walks the
filesystem for a `.php-cs-fixer.php` and there is no filesystem to walk, so a
project's settings have to be read and passed in.

### Rust — the `prettyplease` package, and why it was right to remove it

There was once a `packages/rust` wrapping `prettyplease`, and it is still the
clearest illustration of the exactness rule. It was a *different* formatter
wearing the Rust name: it dropped non-doc comments, because syn discards them
during tokenisation, and its output never survived `cargo fmt --check`. No
package beats a package that quietly is not the tool it names, and the current
package would not exist if that reasoning had been softened instead of acted on.

The removal also recorded a second conclusion — that rustfmt "cannot compile to
wasm at all" — and that part was wrong. The premise was right: `rustc-dev`
genuinely is not distributed for `wasm32-*`. The inference was not, because the
compiler crates can be *built* for wasm rather than downloaded. Worth
remembering as a pattern: "the toolchain does not ship it" is a fact about
distribution, and it was mistaken here for a fact about the code.


### `@scalar/rust-fmt` (`packages/rust`)

Reference: **rustfmt**. Status: exact.

Runs actual rustfmt compiled to `wasm32-wasip1`, verified byte-identical against
the native binary across rustfmt's entire 345-file `tests/source` corpus.

This is the package whose build is least like the others, because rustfmt is not
a normal crate: it opens with `#![feature(rustc_private)]` and links eight
compiler crates from the sysroot. rustup ships those in `rustc-dev`, which is
published for host targets only — no wasm target exists, and no amount of
`rustup target add` produces one. `build/rust_fmt/SPIKE.md` is the full account;
the short version is that the compiler crates are ordinary Rust wanting
bootstrap's *environment* rather than bootstrap itself, so plain cargo
cross-compiles them once `CFG_RELEASE` and five siblings are set.

Three things about the build are load-bearing rather than incidental.

**rustfmt is built as a member of the `rust-lang/rust` workspace**, not from a
standalone checkout. Standalone, rustfmt and the compiler crates resolve
different versions of `tracing`, `annotate_snippets` and `ignore`, and no
arrangement of `--extern` reconciles them. As a workspace member cargo unifies
the graph and the conflict does not arise.

**The compiler crates are injected by an `RUSTC_WRAPPER`, not `RUSTFLAGS`.**
Cargo probes rustc with `--print=file-names` to learn target details, and an
`--extern` in `RUSTFLAGS` breaks that probe with an error that names neither
cause nor cure. The wrapper skips probes and host builds and adds the flags
only to real wasm compilations.

**The version pin is two values that move together.** rustfmt's output is welded
to the compiler it parses with, so `RUST_NIGHTLY` and `RUST_COMMIT` in
`build.sh` must agree, and the conformance test reads `RUST_COMMIT` back and
skips unless the native `rustfmt` on hand reports that same commit. Comparing
against a different rustfmt would fail for the wrong reason, which is worse than
not comparing.

**Configuration does not go through `rustfmt.toml`.** Every path through
rustfmt's `load_config` reaches `fs::canonicalize`, which Rust's standard library
does not implement on `wasm32-wasip1` at all — so a config file on the JavaScript
side could never be read. Options are applied through `Config::override_value`
instead, the same code path as `rustfmt --config key=value`, which keeps the
option names, the value grammar and the defaults rustfmt's own.

## Vendored sources

`packages/*/vendor/` holds third-party sources copied verbatim, with versions
pinned in a `VERSIONS.json` alongside them. Never hand-edit vendored files —
re-vendor and bump the pin instead. Biome is configured to ignore them.

## Design principles

- **Compile the real tool.** Every exact target is exact because it ships the
  reference implementation rather than an approximation of it.
- **Be loud about gaps.** A yellow status with a written explanation is worth
  more than a green one that quietly diverges.
- **No build step where none is needed.** The Ruby package vendors pure-Ruby gem
  sources precisely so that nothing has to be compiled to produce it. The one
  build a package does have is `tsc`, which buys generated declarations that
  cannot fall out of step with the code they describe.
- **Never interpolate user source into a host language.** The Ruby package writes
  input into the guest filesystem rather than into Ruby code, because Ruby
  evaluates `#{...}` inside double quotes and JSON escaping does not escape `#`.
