# Scalar Formatters

[![CI](https://github.com/scalar/formatters/actions/workflows/ci.yml/badge.svg)](https://github.com/scalar/formatters/actions/workflows/ci.yml)
[![License](https://img.shields.io/npm/l/%40scalar%2Fruby-fmt)](https://github.com/scalar/formatters/blob/main/LICENSE)
[![Discord](https://img.shields.io/discord/1135330207960678410?style=flat&color=5865F2)](https://discord.gg/scalar)

Real code formatters compiled to WebAssembly, typed for TypeScript, with one hard constraint: formatting must work with nothing installed but Node.

---

Scalar is an open-source API platform for teams who want beautiful developer interfaces without vendor lock-in.

- **[API References](https://scalar.com/products/api-references/getting-started)** — Interactive API documentation from OpenAPI and AsyncAPI specs.
- **[Developer Docs](https://scalar.com/products/docs/getting-started)** — Write in Markdown/MDX, generate API references, sync with two-way Git.
- **[SDK Generator](https://scalar.com/products/sdk-generator/getting-started)** — Type-safe SDKs and CLIs in TypeScript, Python, Go, PHP, Java, and Ruby.
- **[API Client](https://scalar.com/products/api-client/getting-started)** — Open-source, offline-first Postman alternative built on OpenAPI.

20M+ monthly npm installs · 15,500+ GitHub stars · MIT licensed · [scalar.com](https://scalar.com)

---

No Ruby install, no gems, no JVM, no .NET SDK, no Swift toolchain, no PHP or
Composer, no native binaries, no postinstall downloads.

## Packages

| Package | Reference | Artifact | Status | Browser |
|:---|:---|---:|:---|:---|
| [`@scalar/ruby-fmt`](packages/ruby) | syntax_tree + RuboCop | 12.7 MB | ✅ exact +3 fixes | ✅ |
| [`@scalar/java-fmt`](packages/java) | google-java-format | 0.77 MB | ✅ exact | ✅ |
| [`@scalar/kotlin-fmt`](packages/kotlin) | ktfmt | 0.82 MB | ✅ exact | ✅ |
| [`@scalar/csharp-fmt`](packages/csharp) | CSharpier | 4.2 MB | ✅ exact | ✅ |
| [`@scalar/swift-fmt`](packages/swift) | swift-format | 12.4 MB | ✅ exact | ✅ |
| [`@scalar/php-fmt`](packages/php) | PHP CS Fixer | 0.44 MB | ✅ exact | — |
| [`@scalar/rust-fmt`](packages/rust) | rustfmt | 1.3 MB | ✅ exact | ✅ |

Artifact is the brotli-compressed module as committed and published — the whole
tool, its parser and its language runtime in one file. The JavaScript that loads
it is small by comparison: nothing for Ruby, Swift, PHP and Rust, a 16 KB
generated runtime for Java and Kotlin, and 0.46 MB of .NET loader scripts for C#.

Ruby names two tools because it runs two: syntax_tree reprints the file, then
RuboCop's Layout department corrects what syntax_tree leaves behind, so the
result is clean under a consumer's own `rubocop` run. Both are the real gems,
each held to the exactness rule below by its own conformance test.

Ruby is the second largest artifact, behind Swift, and 7 MB of that is a
deliberate trade: it ships a Ruby VM that has *already* loaded both gems, so the
first `format` call costs under a second rather than ~11.1 s. See
[`packages/ruby`](packages/ruby#what-it-costs).

Exactness is only meaningful against a named reference tool, so the reference is
stated per package. "Exact" means the package *is* that tool compiled to wasm —
not a reimplementation of it. A reimplementation drifts, because a formatter's
line-breaking heuristics are emergent from its implementation rather than
specified anywhere, and the drift stays invisible until a consumer's CI fails.

Ruby reads `exact +3 fixes` because it carries three deviations from the gem it
ships, all of them fixes for syntax_tree bugs that turn valid `case`/`in` code
into a syntax error. Each is tested against native syntax_tree so it cannot
drift quietly, and each goes away when the fix lands upstream —
[details below](#ruby).

Browser is the same claim held to the same standard: ✅ means the package has a
`browser` export condition and `bun run test:browser` loads that build in real
Chromium and asserts byte-identical output to the Node build. It is not a
prediction that it ought to work.

## Installation

```bash
npm install @scalar/ruby-fmt
```

## Usage

Every package is written in TypeScript and ships its own declarations, so the
options and the return type come from the source rather than from a hand-written
`.d.ts` that can fall out of step.

```ts
import { format, type FormatOptions } from '@scalar/ruby-fmt'

const options: FormatOptions = { printWidth: 100 }

const formatted: string = await format('x=[1,2,3].map{|n| n*2}', options)
// x = [1, 2, 3].map { |n| n * 2 }
```

`format` is async because the first call boots a Ruby VM. The VM is cached, so
every later call is milliseconds.

### Formatting without awaiting

Some callers have no `await` to give — a code generator that formats each file
inside the synchronous builder that emits it, a template renderer, a plugin hook
that has to return a string. Every package exports `formatSync` for them:

```ts
import { formatSync, init } from '@scalar/ruby-fmt'

await init()
const formatted: string = formatSync('x=[1,2,3].map{|n| n*2}')
```

Booting is the one thing that cannot be made synchronous — the wasm has to be
read or fetched, and compiled — so `init` covers it once and `formatSync` throws
until it has. Everything after that already was synchronous; `format` was only
ever awaiting the boot.

Prefer `format` where you can await: it needs no setup call and cannot throw that
error. Ruby carries one extra caveat — see [its README](packages/ruby#readme) —
because recycling its VM is asynchronous too.

## Browsers

Ruby, Java, Kotlin, C#, Swift and Rust run in a browser as well as under Node.
The import does not change; bundlers and browsers pick the `browser` export
condition on their own:

```ts
import { format } from '@scalar/rust-fmt'

await format('pub fn add(a: i32,b:i32)->i32{a+b}')
```

Same function, same options, same bytes out. What differs is only how the wasm
arrives: fetched rather than read from disk.

**Run it in a worker.** Every one of these compiles multi-megabyte wasm and holds
tens to hundreds of megabytes of linear memory. On the main thread that is a
frozen tab, and Swift — 12.4 MB over the wire, 48.7 MB of wasm — is one you want
behind an explicit user action rather than on page load.

### Where the bytes come from

The default resolves the artifact next to the module. Vite, Rollup and webpack
recognise that form, emit the artifact as a hashed asset and rewrite the URL to
match; a CDN resolves it with no build step at all. esbuild is the exception —
it leaves the URL alone — so an esbuild build needs the artifact copied beside
its output, or named explicitly. Either way, `init` says so:

```ts
import { format, init } from '@scalar/rust-fmt'

await init({ url: '/assets/rust_fmt.wasm.br' })
```

`init` is optional, it must come before the first `format`, and it doubles as a
way to pay the download up front rather than during the first call.

### Compression

The browser reads the same brotli-compressed artifact the Node build does, rather
than a second copy in a friendlier format — a gzip twin would cost 41–59% more
over the wire and would double what every Node install carries for a file it
never opens.

Why decompress at all, when browsers already decode brotli for free? Because
that is *transfer* encoding — it happens when a server sends `Content-Encoding:
br`, and the browser undoes it before your code sees a byte. This artifact is
compressed *at rest*: the `.br` is what is committed and published, which is what
keeps an install megabytes rather than tens of megabytes. A bundler or CDN serves
it as opaque bytes with no encoding declared, so nothing has told the browser it
is brotli and nothing decodes it.

Expanding it uses `DecompressionStream('brotli')` where the engine has it
(Safari 18.4+, Firefox 147+) and falls back to a 208 KB wasm decoder otherwise.
Chrome has not shipped native brotli yet, so today the fallback is the common
path; it is loaded dynamically, so engines that do not need it never fetch it,
and it disappears from the equation as Chrome catches up.

If you serve the artifact yourself you can skip the decoder entirely, either by
setting `Content-Encoding: br` on the `.br` file or by serving an uncompressed
`.wasm`. Both are the same call:

```ts
await init({ url: '/assets/rust_fmt.wasm', encoding: 'none' })
```

### C# carries one extra file set

C#'s runtime is the Blazor runtime, and it is the only package whose assets are
not all bytes: it imports four `runtime/*.js` files as ES modules *by URL*, so
they have to exist at one. They resolve next to the module by default and Vite,
Rollup and webpack emit them as hashed assets unaided — verified against a real
Vite production build, which rewrites all four and still boots. Where they land
somewhere those cannot derive, name the directory:

```ts
await init({ runtimeBaseUrl: '/assets/dotnet' })
```

## Inspired by the wasm-fmt packages

The approach comes from [`@wasm-fmt`](https://github.com/wasm-fmt), which ships
the real formatter compiled to WebAssembly instead of a lookalike — `gofmt`,
`clang-format`, `dart_style`, `ruff format`, all reachable from Node with no
toolchain installed. These packages do the same thing for the languages that set
does not cover.

## Ruby

See [`packages/ruby`](packages/ruby). It runs the real syntax_tree gem on real
CRuby compiled to wasm, so output is byte-identical to a native Ruby; a
conformance test asserts that against a native `ruby` across classes, endless
methods, `case`/`when`, blocks and heredocs.

It is also the one package that runs two tools, because neither does the whole
job. syntax_tree reprints a file - it throws away the input's line breaking and
decides it again - but about 30% of its output still trips stock
`rubocop --only Layout`. RuboCop corrects those offenses but never reprints: on
116 files whose formatting differed only in line breaking, RuboCop alone brought
none of them to a common result, and syntax_tree brought 91. So `format` runs
syntax_tree and then `rubocop --autocorrect --only Layout`, in that order,
and a second conformance test asserts byte-identity against `RuboCop::CLI` with
both gem versions pinned.

`format(source, { rubocop: false })` is syntax_tree on its own for anyone who
wants it, and saves the pass rather than the loading - the artifact carries
RuboCop either way. See
[`packages/ruby`](packages/ruby#two-tools-and-why-both) for the rest of what it
costs.

It ships as one 12.7 MB `ruby_fmt.wasm.br` with CRuby and the gems baked in,
built by [`build/ruby_fmt/build.sh`](build/ruby_fmt/build.sh) - stdlib the
formatter never loads is stripped, then `wasm-opt -Os`, then
[wizer](https://github.com/bytecodealliance/wizer), then brotli. The wizer step
is what more than doubled it, from 5.2 MB: it boots CRuby, requires syntax_tree
and RuboCop, and serializes the resulting linear memory back into the module, so
a consumer instantiates a VM that is already up instead of spending ~9 s
requiring 698 cop files - and spending it again every time the leak below forces
a recycle. It is committed, so a fresh clone needs nothing extra;
`bun run ruby:build` rebuilds it when the Ruby version or pinned gems change.

The deviations from stock syntax_tree 6.3.0 are all one family: pattern
matching, where the gem writes back Ruby that no longer parses from input that
parsed going in. `then` is mandatory in a clause whose pattern *ends* in an
endless range and syntax_tree only keeps it when the whole pattern is one; a
guarded clause such as `in (400..) if g` loses the parentheses that are its only
legal spelling; and a hash pattern both misprints the ` then` after a bare `**`
and adopts any earlier `n**2` in the file as a `**` that was never written.
`format()` fixes all three, and it also parses everything it produces so a bug
of that shape can never again return a broken file quietly. Formatting the
rubocop, rubocop-ast, syntax_tree, parser and regexp_parser gems both ways —
2,076 files — the patches change none of them.

One caveat worth knowing before you format a whole codebase's worth of files:
the VM leaks about 74 MB of wasm memory per 23 KB of input and would die at the
wasm32 2 GB boundary, so `format()` recycles it before the wall. Since the
artifact is pre-initialized that pause is a fraction of a second rather than the
several seconds it used to be.

## Java

See [`packages/java`](packages/java). It runs the real google-java-format 1.36.1
- javac's own parser included - compiled to WasmGC by [TeaVM](https://teavm.org),
so output is byte-identical to the same version on a JVM. A conformance test
asserts that in both styles, and the build is checked against 658 real Java files
(Guava's and google-java-format's own sources) in both styles - 1316 comparisons,
all identical, and identical again to what a second, independent wasm build of
the same version produces.

`format()` runs the CLI's pipeline rather than just its `Formatter` class -
format, remove unused imports, sort imports, reflow long strings - because the
reference this package claims to be is the tool. Stopping at `formatSource`
leaves imports untouched and text blocks unreflowed, which the conformance test
sees immediately as a divergence.

The package exports `googleJavaFormatVersion` alongside `format`, so a consumer
that has to install the matching jar - to re-verify its own committed bytes in
CI, say - reads the release off the package rather than pinning the number a
second time in its own repository.

One upstream quirk worth knowing: google-java-format is not idempotent in `aosp`
style on a reflowed string literal, and settles on the second pass. This build
reproduces that at every pass, which means formatting here and then verifying
with the jar compares pass one against pass two and looks like a divergence that
is not one. `packages/java/README.md` has the detail and the two ways out.

It ships as a 0.77 MB `java_fmt.wasm.br` plus TeaVM's generated runtime, which
supplies the module's imports. Both are committed, so a fresh clone needs
nothing extra; `bun run java:build:teavm` rebuilds them from a JDK 21, Maven,
git and Node.

**Why TeaVM and not GraalVM.** The first build of this package used GraalVM Web
Image, and it still lives in `build/java_fmt/` - it is equally exact, and the two
agree on every file in the corpus. But its artifact embeds Oracle code under the
GFTC, which permits redistribution only where no fee is charged for the artifact
or for a product bundling it, so shipping it inside anything paid was out.
TeaVM is Apache-2.0 with its own class library rather than OpenJDK's, which
leaves javac's parser as the only non-permissive component - GPLv2 *with the
Classpath Exception*, which exists precisely to allow linking into a product
distributed under terms of your choice. Getting there took patches to TeaVM and
to google-java-format; `packages/java/README.md` names every one.

Two caveats. **Node 24.15 or newer**, and not because of WasmGC: below that V8
does not compile the module at all, because of how it used to type the wasm
exception handling TeaVM emits. bun is unaffected. And the module
has no filesystem and no stdin, so source goes in as a string and comes back as
one - enough for `format()`, but it rules out shipping the CLI itself.

## C#

See [`packages/csharp`](packages/csharp). It runs the real CSharpier 1.3.0 -
Roslyn's own parser included - compiled to WebAssembly by the .NET 10
`browser-wasm` toolchain, so output is byte-identical to the same version on
.NET. A conformance test asserts that, and the build was checked against 613
real C# files - CSharpier's own syntax-coverage corpus and its sources - all of
which came out identical.

Unlike the Java package there is no CLI pipeline to replicate: for a `.cs` file
`csharpier` dispatches straight to the same `CSharpFormatter.Format` that runs
inside the module. The one thing `format()` adds back is the byte-order mark,
which the library drops and the CLI preserves.

It ships as a 4.2 MB `csharp_fmt.br` - the assemblies, the runtime wasm and the
ICU data packed into one brotli archive and fed to the runtime through
`dotnet.withResourceLoader` - plus the four JavaScript files the runtime imports
as ES modules, which have to stay real files. Both are committed, so a fresh
clone needs nothing extra; `bun run csharp:build` rebuilds them using a .NET SDK
the script downloads itself.

Two things in the build change output rather than just size, and
[`build/csharp_fmt/NOTES.md`](build/csharp_fmt/NOTES.md) records them:
`InvariantGlobalization` reorders using directives, because CSharpier sorts them
with a comparison that degrades to ordinal without ICU; and `Diagnostic.ToString()`
traps under AOT, so the error text is assembled from its parts instead.

## Swift

See [`packages/swift`](packages/swift). It runs the real swift-format 603.0.0 -
the release that pairs with Swift 6.3, swift-syntax's parser included - compiled
by the **official** [Swift SDK for WebAssembly](https://www.swift.org/documentation/articles/wasm-getting-started.html)
from swift.org rather than the SwiftWasm fork. A conformance test asserts
byte-identical output against a native `swift-format`, and the build was checked
against 689 real Swift files (swift-format's own sources and tests, swift-syntax,
swift-argument-parser and swift-markdown), all of which came out identical.

`format()` wraps the `SwiftFormat` library rather than the CLI, because the CLI
cannot be compiled at all: its executable target imports Dispatch and the WASI
SDK ships no libdispatch. That is a small gap - `swift-format format <file>`
resolves a configuration and then calls exactly the one method the wrapper
calls. The behaviour that is genuinely missing is `.swift-format` discovery,
since there is no filesystem to search, so a project's configuration has to be
read and passed in.

It ships as a 12.4 MB `swift_fmt.wasm.br`, built by
[`build/swift_fmt/build.sh`](build/swift_fmt/build.sh), which downloads its own
Swift toolchain and SDK. It is committed, so a fresh clone needs nothing extra;
`bun run swift:build` rebuilds it. Three times the size of the other packages,
almost all of it swift-syntax - `-Osize` and `wasm-opt -Oz` were both tried and
moved the compressed total by under 50KB.

Two caveats worth knowing. The module is a **WASI reactor**: instantiated once,
then `run` per format, which measured 2.5x faster than a fresh instance each
time and, unlike the Ruby VM, does not leak - memory plateaus at 75MB and stays
there. And **the licence is unrestricted**, unlike the Java package: everything
embedded is Apache-2.0 with the Runtime Library Exception, so a paid product may
ship a copy.

## PHP

See [`packages/php`](packages/php). It runs the real PHP CS Fixer 3.95.18 - the
official phar, unmodified - on real PHP 8.4 compiled to WebAssembly, so output
is byte-identical to the same phar on a native PHP. A conformance test asserts
that, and the build was checked against 1117 real PHP files (PHP CS Fixer's own
sources and the Symfony, ReactPHP and PSR components vendored into its phar),
all of which came out identical - 1100 of them files the fixer actually
rewrote.

It is also the one package with a synchronous entry point. PHP on wasm has none
and cannot be given one - both builds suspend through Asyncify or JSPI, so every
export returns a promise - so `formatSync()` gets its synchrony from the thread
instead: PHP runs in a worker and the calling thread parks on `Atomics.wait`
until the result lands in shared memory. Same fixer, byte-identical output, and
nothing to install. It blocks the caller for the ~300ms a format takes, which is
the point and also the cost, so prefer `format()` wherever you can await.

It is the slowest package here by a wide margin, and the cost is PHP CS Fixer
rather than the wasm: it autoloads several hundred classes per invocation and
then runs every enabled fixer over every file. Both entry points therefore take
an array as well as a string, and that is the form to use whenever the files are
in hand - the autoload is paid once for the batch, and the batch is split across
PHP instances in separate processes. On a four-core machine 200 generated files
go from 11.5s to 4.6s. The instances are processes rather than worker threads
because that is what actually parallelises: several PHP instances inside one
process barely beat one, however many cores are idle, while the same instances in
separate processes scale nearly linearly.

This is the one package that compiles nothing, and that is the point. The others
compile their reference tool because no wasm build of it exists; PHP CS Fixer is
pure PHP, so the released phar *is* the tool and a maintained wasm PHP already
exists to run it. Building from source here would only add a copy that could
drift. So [`build/php_fmt/build.sh`](build/php_fmt/build.sh) downloads the
pinned phar, checks it really is one, and brotli-compresses it - 3.5MB down to
a committed 0.44MB.

It is also the one package whose runtime is not embedded in its artifact: PHP
arrives as an ordinary npm dependency, `@php-wasm/node-8-4`. That is
deliberately not the `@php-wasm/node` meta-package it sits under, which ships
prebuilt `.node` binaries and an install script - the two things this repo
exists to avoid - depends on every PHP from 7.4 to 8.5, and keeps Node's event
loop alive so a process that formats a file never exits.

Two caveats worth knowing. `format()` drives the `fix` command **in-process**
rather than executing the phar, because PHP's CLI SAPI is one-shot - a second
`cli()` call silently does nothing and hands back unformatted input. And
subprocess functions are disabled inside the runtime, which is load-bearing:
`Config`'s CPU-core detection shells out through `proc_open`, leaked a pipe on
every format, and killed the runtime after ~100 of them.

## Rust

See [`packages/rust`](packages/rust). It runs the real rustfmt — the build that
ships with the pinned nightly, rustc's own parser included — compiled to
`wasm32-wasip1`, so output is byte-identical to the same version natively. A
conformance test asserts that across functions, traits, generics, lifetimes,
macros, async and unicode under four configurations, and the build was checked
against rustfmt's entire 345-file `tests/source` corpus, all of which came out
identical with matching exit status on the six rustfmt refuses.

That this is possible at all is the interesting part. rustfmt links eight
compiler crates behind `#![feature(rustc_private)]`, and rustup publishes the
`rustc-dev` component that carries them for 34 host targets and no wasm target —
which is why this repo previously concluded it could not be done. But those
crates are ordinary Rust that wants bootstrap's *environment*, not bootstrap:
given `CFG_RELEASE` and five siblings, plain cargo cross-compiles them with zero
errors. rustfmt itself needs three lines of `#[cfg]`.
[`build/rust_fmt/SPIKE.md`](build/rust_fmt/SPIKE.md) is the full account.

It ships as a 1.3 MB `rust_fmt.wasm.br`, built by
[`build/rust_fmt/build.sh`](build/rust_fmt/build.sh) — which is not what eight
rustc crates and a parser sound like. It is committed, so a fresh clone needs
nothing extra; `bun run rust:build` rebuilds it.

Two caveats. The module has no filesystem, so a project's `rustfmt.toml` is
**not** discovered — read it and pass it in, and remember rustfmt's default
edition is 2015, so modern syntax needs `{ edition: '2021' }` exactly as it does
on the CLI. And wasm cannot grow its stack the way `stacker` does natively, so
the build links with `-z stack-size=33554432`; at 32 MB it matches native at
every nesting depth native itself survives, but at the 1 MB default it would
trap on deeply nested expressions native handles fine.

## Development

```bash
bun install
bun run build      # compile each package's TypeScript to dist/
bun run test       # bun test suite
bun run test:node  # load the built packages under plain Node (24+ for Java)
bun run test:browser  # load the built browser packages in real Chromium
bun run check      # biome lint + format check
bun run types:check
```

```
build/                  build pipelines for wasm artifacts
packages/               published npm packages
  <pkg>/src/            TypeScript sources, one function per file
  <pkg>/dist/           compiled output — what consumers import (gitignored)
  <pkg>/test/           integration tests and the plain-Node smoke test
scripts/                repo tooling
tsconfig.json           strict base config, shared by every package
tsconfig.build.json     the same, in emit mode
tsconfig.scripts.json   covers scripts/ and the build pipelines' scripts
tsconfig.node-smoke.json  the smoke tests, checked against built dist
```

Bun is the development toolchain — package manager, test runner, script runner —
but nothing a published package does at runtime may depend on it. That is what
`bun run test:node` is for: it loads each package's built `dist` under plain
Node and formats through it.

`bun run test:browser` holds the browser builds to the same standard, in a real
Chromium: it serves the repo, resolves bare specifiers through an import map the
way a bundler would, and asserts each package's output matches the Node build
byte for byte. Chromium rather than a faster headless engine because it is the
one without native brotli, so it is the one that exercises the wasm decoder
fallback. It needs a browser (`bunx playwright install chromium`), or point
`CHROMIUM_EXECUTABLE` at one you already have.

## Contributing

[`CONTRIBUTING.md`](CONTRIBUTING.md) has the workflow, the exactness rule every change is held
to, and the changeset each pull request carries. Vulnerabilities go through
[`SECURITY.md`](SECURITY.md)'s private route rather than the issue tracker.

## Community

We are API nerds. You too? Let's chat on Discord: <https://discord.gg/scalar>

## Thank you

The approach here is [`@wasm-fmt`](https://github.com/wasm-fmt)'s: ship the real
formatter compiled to WebAssembly rather than a reimplementation that looks like
it. These packages extend that idea to languages the wasm-fmt set does not cover.

## License

The source code in this repository is licensed under [MIT](https://github.com/scalar/formatters/blob/main/LICENSE).
