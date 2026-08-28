# Scalar Kotlin Formatter

[![Version](https://img.shields.io/npm/v/%40scalar%2Fkotlin-fmt)](https://www.npmjs.com/package/@scalar/kotlin-fmt)
[![Downloads](https://img.shields.io/npm/dm/%40scalar%2Fkotlin-fmt)](https://www.npmjs.com/package/@scalar/kotlin-fmt)
[![License](https://img.shields.io/npm/l/%40scalar%2Fkotlin-fmt)](https://www.npmjs.com/package/@scalar/kotlin-fmt)
[![Discord](https://img.shields.io/discord/1135330207960678410?style=flat&color=5865F2)](https://discord.gg/scalar)

Kotlin formatter that runs on plain Node. No JVM, no `java` on `PATH`, no postinstall download.

---

Scalar is an open-source API platform for teams who want beautiful developer interfaces without vendor lock-in.

- **[API References](https://scalar.com/products/api-references/getting-started)** — Interactive API documentation from OpenAPI and AsyncAPI specs.
- **[Developer Docs](https://scalar.com/products/docs/getting-started)** — Write in Markdown/MDX, generate API references, sync with two-way Git.
- **[SDK Generator](https://scalar.com/products/sdk-generator/getting-started)** — Type-safe SDKs and CLIs in TypeScript, Python, Go, PHP, Java, and Ruby.
- **[API Client](https://scalar.com/products/api-client/getting-started)** — Open-source, offline-first Postman alternative built on OpenAPI.

20M+ monthly npm installs · 15,500+ GitHub stars · MIT licensed · [scalar.com](https://scalar.com)

---

```bash
npm i @scalar/kotlin-fmt
```

```js
import { format } from '@scalar/kotlin-fmt'

await format('fun  f( ) {\nval x=listOf(1,2,3)\n}')
// fun f() {
//   val x = listOf(1, 2, 3)
// }
```

Async because the first call decompresses the artifact, compiles it and
instantiates the module. That work is cached, so every later call is tens of
milliseconds.

Options, all defaulting to ktfmt's own values rather than anything we picked:

| Option | Default | ktfmt equivalent |
|---|---|---|
| `style` | `'meta'` | `--meta-style` / `--google-style` / `--kotlinlang-style` |
| `maxWidth` | `100` | `maxWidth` |
| `blockIndent` | per style | `blockIndent` |
| `continuationIndent` | per style | `continuationIndent` |
| `trailingCommas` | per style | `trailingCommaManagementStrategy` |
| `removeUnusedImports` | `true` | `removeUnusedImports` |
| `preserveLambdaBreaks` | `true` | `preserveLambdaBreaks` |

`meta` is 2-space blocks with 4-space continuations; `google` is 2 and 2;
`kotlinlang` is 4 and 4. ktfmt's own help says "If none of the style options are
passed, Meta's style is used", so that is the default here too.

Source ktfmt cannot parse throws, carrying ktfmt's diagnostic including line and
column:

```js
await format('fun f( {')
// Error: com.facebook.ktfmt.format.ParseError: 1:7: error: Expecting ')'
```

**Node 24.15 or newer**, and it is a hard floor: below it V8 does not compile
the module at all. Not a WasmGC floor — Node 22 has WasmGC — but a question of
how V8 types wasm exception handling. TeaVM emits `try_table` over `exnref`, and
`wasm-opt` leaves `catch_ref` branching to a block typed with a non-nullable
`(ref exn)`, which is what the spec calls for; V8 used to type it as nullable and
reject the module, on Node 22 and on 24.0 through 24.14 alike. JavaScriptCore
accepts it throughout, so bun is fine. The package checks and says so rather than
failing obscurely; the check compiles a 52-byte probe of that exact shape rather
than reading a version number, so bun — reporting a Node version of its own — is
judged on what its engine actually does. See
[`packages/java`](../java#readme) for the long version; both packages are TeaVM
output and hit the same thing.

## The version it carries

```js
import { ktfmtVersion } from '@scalar/kotlin-fmt'

ktfmtVersion // '0.64'
```

"Exact against ktfmt" is a claim about a named release, so the release is
readable rather than something you look up. It is what a consumer needs to
install the matching jar — to verify its own committed bytes in CI, or to pin a
container image — and having it here means that number is not maintained twice,
once in your repository and once in ours.

`src/version.test.ts` reads `KTFMT_VERSION` out of the build script and fails if
the two ever disagree, so the export cannot go stale across a bump.

## Formatting without awaiting

`formatSync` is for callers with no `await` to give — a code generator that
formats each file inside the synchronous builder that emits it, a template
renderer, a plugin hook that has to return a string.

```js
import { formatSync, init } from '@scalar/kotlin-fmt'

await init()
const formatted = formatSync(source)
```

Booting is the one thing that cannot be made synchronous, so `init` covers it
once and `formatSync` throws until it has. Everything after that already was
synchronous — `format` was only ever awaiting the boot, and both produce the
same bytes.

Prefer `format` where you can await: it needs no setup call and cannot throw that
error.

## It runs in the browser too

The import does not change — bundlers and browsers pick the `browser` export
condition on their own, and `format` has the same signature and returns the same
bytes. Only the wasm's route in differs: fetched rather than read from disk.

```js
import { format, init } from '@scalar/kotlin-fmt'

// Optional. The artifact resolves next to the module by default, which Vite,
// Rollup, webpack and a plain CDN handle unaided. esbuild does not rewrite
// `new URL(..., import.meta.url)`, so there it needs naming.
await init({ url: '/assets/kotlin_fmt.wasm.br' })

await format(source)
```

Run it in a worker. Booting compiles 3.5 MB of wasm, which is a visibly frozen
tab if it happens on the main thread.

The engine floor is checked at boot and is real: the module uses the final wasm
exception-handling opcodes, so Chrome 137, Firefox 131 or Safari 18.4 at the
earliest.

The browser reads the same brotli artifact as Node (0.82 MB over the wire) and
expands it with `DecompressionStream('brotli')` where the engine has it, or a
208 KB wasm decoder where it does not — Chrome, today. Serving the artifact with
`Content-Encoding: br`, or serving an uncompressed `.wasm`, skips the decoder
entirely:

```js
await init({ url: '/assets/kotlin_fmt.wasm', encoding: 'none' })
```

## This is the real ktfmt, and the output is exact

This is **actual [ktfmt](https://github.com/facebook/ktfmt) 0.64** — including
the Kotlin compiler's own PSI parser, which is what it uses to read Kotlin —
compiled to WebAssembly by [TeaVM](https://teavm.org). It is not a
reimplementation, so it does not drift.

The claim is checked in two halves, because there are two places output could
change, and both are byte-for-byte over the same 589 real Kotlin files from
kotlin-stdlib, kotlinx-coroutines and ktfmt itself, in all three styles:

| | What it asks | Result |
|---|---|---|
| `build/java_fmt_teavm/kotlin-probe/gate2.sh` | does the one patched file change ktfmt's output, on a JVM? | 1767/1767 identical, diagnostics included |
| `build/java_fmt_teavm/kotlin-probe/conformance.sh` | does compiling that to wasm change it? | 1767/1767 identical |

Together those chain: stock ktfmt on a JVM → patched ktfmt on a JVM → this
module. Failures are compared too, encoded the same way on both sides, so a
reworded diagnostic would count as a divergence.

### The one patched file, and why it does not affect that claim

ktfmt opens a `KotlinCoreEnvironment` to parse. That is the *compiler's* CLI
environment: it resolves a JVM classpath, opens jars, and registers extension
points named by string in an XML descriptor. An ahead-of-time compiler cannot
follow any of that, and parsing does not need it.

So `Parser`'s initializer — 20 lines of one file — builds the smallest container
that can hold a PSI file instead, which is the same one `KotlinCoreEnvironment`
builds underneath. Everything below it is ktfmt's, unchanged: the same
`LightVirtualFile` with the same name, and the same `PsiManager` lookup, so the
tree that comes out is the tree ktfmt formats. `gate2.sh` is the evidence, and
the diff is `build/java_fmt_teavm/patches/ktfmt.patch`.

### TeaVM is patched too

Six patches, five of them ordinary bug fixes or missing class-library members,
and one a miscompile — `ClassInitElimination` treated any invocation as
initializing the class it names, which deleted a class initializer that a later
read of the same class's static field depended on. They are listed in
`build/java_fmt_teavm/patches/README.md`; none has landed upstream yet.

One group is a deliberate divergence rather than a fix: `Thread.yield`,
`Thread.sleep` and `Object.wait` are stand-ins that do nothing or throw, because
this module is single-threaded. They are also what makes it small — a single
`Thread.yield()` reachable in kotlinx-coroutines made a third of the program a
coroutine and the module 37% larger.

`LockSupport.park` is one of those stand-ins, and it used to be audible. Opening
ktfmt's parser builds an IntelliJ `CoreProjectEnvironment`, which launches two
coroutines and so starts kotlinx-coroutines' scheduler; its workers park waiting
for work, the stand-in throws, and TeaVM's default handler wrote the resulting
stack trace to `console.error` — once per process, on the timer turns after the
first `format` had already resolved. Formatting was correct throughout. The
module now installs a handler that drops exactly that — an
`UnsupportedOperationException` whose message is one of the stand-ins refusing,
"would block the only thread" or "cannot be satisfied with one thread" — and
prints everything else, because those coroutines are real and a genuine failure
on one is the only way it would ever be seen. `packages/kotlin/test/quiet.test.ts`
formats in a child process and asserts its stderr is empty, so if TeaVM rewords a
refusal the noise comes back rather than the silence spreading.

## Building it

```bash
bun run kotlin:build
```

Needs a JDK 21, Maven, git and Node; it fetches TeaVM, ktfmt, Binaryen and the
repo's pinned Node into a gitignored `toolchain/`. TeaVM's output then goes
through `wasm-opt -O3`, which takes the artifact from 0.91 MB to 0.82 MB and
formats about 14% faster; `conformance.sh` is what says it changed no output.
See [`packages/java`](../java#readme) for why that pass was skipped until
recently — it was a V8 bug, not a Binaryen one. Around 15 minutes cold, most of it
compiling TeaVM. The artifact is committed, so this only needs rerunning when a
pin or a patch changes.

## Community

We are API nerds. You too? Let's chat on Discord: <https://discord.gg/scalar>

## License

MIT, for the TypeScript in this package.

The wasm artifact embeds ktfmt, the Kotlin compiler's PSI, google-java-format's
layout engine, Guava and TeaVM's class library — all Apache-2.0. See
`licenses/NOTICE.md`.
