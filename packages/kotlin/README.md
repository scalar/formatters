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

The output is ktfmt's, byte for byte, held to the real ktfmt 0.65 by a
conformance test. It comes from [ktrs](https://github.com/Hexay/ktrs), a Rust
reimplementation of ktfmt compiled to WebAssembly, not from ktfmt itself; see
[below](#the-output-is-ktfmts-held-there-by-test) for what that means and how
it is checked.

The first call decompresses, compiles and instantiates a 200 KB module, which
takes about 15 ms under Node. Later calls reuse it: okhttp's 617 files format
at about 1.5 ms each.

Options, all defaulting to ktfmt's own values rather than anything we picked:

| Option | Default | ktfmt equivalent |
|---|---|---|
| `style` | `'meta'` | `--meta-style` / `--google-style` / `--kotlinlang-style` |
| `maxWidth` | `100` | `maxWidth` |
| `blockIndent` | per style | `blockIndent` |
| `continuationIndent` | per style | `continuationIndent` |
| `trailingCommas` | per style | `trailingCommaManagementStrategy` |
| `removeUnusedImports` | `true` | `removeUnusedImports` (`--do-not-remove-unused-imports`) |
| `preserveLambdaBreaks` | `true` | `preserveLambdaBreaks` |

`meta` is 2-space blocks with 4-space continuations; `google` is 2 and 2;
`kotlinlang` is 4 and 4. ktfmt's own help says "If none of the style options are
passed, Meta's style is used", so that is the default here too. An option
value the package does not know throws rather than falling back to a default.

Source is parsed as a script, which is how ktfmt reads standard input: it
accepts everything a `.kt` file can hold, and top-level statements besides. A
leading byte-order mark is dropped, as ktfmt's CLI drops it. Source ktfmt cannot
parse throws ktfmt's diagnostic, line and column included, as the CLI prints it
minus the file name:

```js
await format('fun f( {')
// Error: 1:7: error: Expecting ')'
```

Any Node from 18 on. The module imports nothing and uses no recent wasm feature.

## The versions it carries

```js
import { ktfmtVersion, ktrsVersion } from '@scalar/kotlin-fmt'

ktfmtVersion // '0.65'  - the ktfmt release the output matches
ktrsVersion // '0.5.3' - the ktrs release the artifact is compiled from
```

"Identical to ktfmt" is a claim about a named release, so the release is
readable rather than something you look up. It is what a consumer needs to
install the matching jar, to verify its own committed bytes in CI or to pin a
container image.

`src/version.test.ts` reads both pins out of `build/kotlin_fmt/build.sh` and
fails if either export disagrees, so neither can go stale across a bump.

## Formatting without awaiting

`formatSync` is for callers with no `await` to give: a code generator that
formats each file inside the synchronous builder that emits it, a template
renderer, a plugin hook that has to return a string.

```js
import { formatSync } from '@scalar/kotlin-fmt'

const formatted = formatSync(source)
```

Under Node it needs nothing first: reading, decompressing and compiling the
module are all synchronous there, so `format` and `formatSync` run the same
code. `init()` is accepted and only moves the ~15 ms cold start to a moment of
your choosing. In a browser, `formatSync` needs one `await init()` first,
because the artifact has to be fetched.

## It runs in the browser too

The import does not change. Bundlers and browsers pick the `browser` export
condition on their own, and `format` has the same signature and returns the same
bytes. Only the wasm's route in differs: fetched rather than read from disk.

```js
import { format, formatSync, init } from '@scalar/kotlin-fmt'

// Optional for `format`, required once before `formatSync`. The artifact
// resolves next to the module by default, which Vite, Rollup, webpack and a
// plain CDN handle unaided. esbuild does not rewrite
// `new URL(..., import.meta.url)`, so there it needs naming.
await init({ url: '/assets/kotlin_fmt.wasm.br' })

await format(source)
formatSync(source)
```

The module is 864 KB, so it is fine on the main thread: a browser refuses
synchronous compilation only above 8 MB. Any engine with WebAssembly runs it;
there is no engine floor to check.

The browser reads the same brotli artifact as Node (200 KB over the wire) and
expands it with `DecompressionStream('brotli')` where the engine has it, or a
208 KB wasm decoder where it does not (Chrome, today). Serving the artifact with
`Content-Encoding: br`, or serving an uncompressed `.wasm`, skips the decoder
entirely:

```js
await init({ url: '/assets/kotlin_fmt.wasm', encoding: 'none' })
```

## The output is ktfmt's, held there by test

This package is **not ktfmt compiled**. It is
[ktrs](https://github.com/Hexay/ktrs), which reimplements ktfmt in Rust, the
Kotlin compiler's lexer and parser included, and whose own parity gates run it
against the ktfmt jar nightly. A reimplementation is only exact while something
keeps checking it, so this package checks it too, against the real tool.

`test/ktfmt-conformance.test.ts` runs ktfmt 0.65's release jar over the same
input and **asserts** byte-identical output: formatted source where ktfmt
formats, and the same diagnostic where it refuses. It covers every style and
`--do-not-remove-unused-imports`, over its own samples and over any corpus
named by `KOTLIN_FMT_CONFORMANCE_CORPUS`. CI downloads the jar, through
`build/kotlin_fmt/ktfmt.sh`, which checks it against a pinned checksum, so the
test runs there rather than skipping.

Over the corpora ktrs itself pins, every file in every configuration matched:

| Corpus | Files | Identical (meta / google / kotlinlang / keeping imports) |
|---|--:|---|
| [square/okhttp](https://github.com/square/okhttp) @ `40a3b87` | 617 | 617 / 617 / 617 / 617 |
| [Kotlin/kotlinx.coroutines](https://github.com/Kotlin/kotlinx.coroutines) @ `bd2e9a1` | 1,082 | 1,082 / 1,082 / 1,082 / 1,082 |

What is *not* compared against the jar: `maxWidth`, `blockIndent`,
`continuationIndent`, `trailingCommas` and `preserveLambdaBreaks` set apart
from a style. ktfmt's CLI has no flags for them, so only its library API could
be the oracle. ktrs ports them as the same `FormattingOptions` fields the styles
are made of, and the unit tests cover them.

### What changed from the previous version

Up to 0.4, this package was ktfmt 0.64 itself, compiled to WasmGC by a patched
TeaVM. That was exact by construction, but it cost a 0.82 MB artifact, a Node
24.15 floor set by how V8 typed wasm exception handling, an async-only boot, a
fork of TeaVM with a dozen patches, and stand-ins for the threads IntelliJ's
parser environment started. ktrs is a quarter of the size, boots synchronously,
runs on any engine, and matched every corpus file above.

The cost is the one the exactness rule names: a reimplementation can drift where
a compiled tool cannot. The conformance test is how drift would be caught.
Bump the ktrs pin only with a corpus run.

## Building it

```bash
bun run kotlin:build
```

Needs rustup, git and Node. It installs the repo's pinned Rust toolchain and the
`wasm32-unknown-unknown` target, clones ktrs at the pinned commit into a
gitignored `build/kotlin_fmt/ktrs`, and builds `build/kotlin_fmt/entry`, a small
crate that exposes ktrs's formatter as plain wasm exports. It takes about 20
seconds. The artifact is committed, so this only needs rerunning when a pin or
the entry crate changes.

To run the conformance test locally, fetch the oracle first (it needs a JDK 17
or newer):

```bash
bun run kotlin:ktfmt
```

## Community

We are API nerds. You too? Let's chat on Discord: <https://discord.gg/scalar>

## License

MIT, for the TypeScript in this package.

The wasm artifact is ktrs (MIT OR Apache-2.0), with ec4rs, text-size and the
Rust standard library linked in. It carries code ktrs ported from the Kotlin
compiler, the IntelliJ Platform, ktfmt, google-java-format and ec4j, all
Apache-2.0. Everything in it is distributed under Apache-2.0, with no copyleft
component. See `licenses/NOTICE.md`.
