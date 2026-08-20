# Scalar Java Formatter

[![Version](https://img.shields.io/npm/v/%40scalar%2Fjava-fmt)](https://www.npmjs.com/package/@scalar/java-fmt)
[![Downloads](https://img.shields.io/npm/dm/%40scalar%2Fjava-fmt)](https://www.npmjs.com/package/@scalar/java-fmt)
[![License](https://img.shields.io/npm/l/%40scalar%2Fjava-fmt)](https://www.npmjs.com/package/@scalar/java-fmt)
[![Discord](https://img.shields.io/discord/1135330207960678410?style=flat&color=5865F2)](https://discord.gg/scalar)

Java formatter that runs on plain Node. No JVM, no `java` on `PATH`, no postinstall download.

---

Scalar is an open-source API platform for teams who want beautiful developer interfaces without vendor lock-in.

- **[API References](https://scalar.com/products/api-references/getting-started)** — Interactive API documentation from OpenAPI and AsyncAPI specs.
- **[Developer Docs](https://scalar.com/products/docs/getting-started)** — Write in Markdown/MDX, generate API references, sync with two-way Git.
- **[SDK Generator](https://scalar.com/products/sdk-generator/getting-started)** — Type-safe SDKs and CLIs in TypeScript, Python, Go, PHP, Java, and Ruby.
- **[API Client](https://scalar.com/products/api-client/getting-started)** — Open-source, offline-first Postman alternative built on OpenAPI.

20M+ monthly npm installs · 15,500+ GitHub stars · MIT licensed · [scalar.com](https://scalar.com)

---

```bash
npm i @scalar/java-fmt
```

```js
import { format } from '@scalar/java-fmt'

await format('class A{int x  =  1;void f(){g( "hi" );}}')
// class A {
//   int x = 1;
//
//   void f() {
//     g("hi");
//   }
// }
```

Async because the first call decompresses the artifact, compiles it and
instantiates the module — about 0.2s. That work is cached, so every later call
is tens of milliseconds.

Options: `{ style }` (`'google'` default, or `'aosp'`), and the three steps the
CLI runs by default, each of which can be turned off — `{ sortImports }`,
`{ removeUnusedImports }`, `{ reflowLongStrings }`.

**Node 24.15 or newer.** Two separate things set that floor, and neither is
WasmGC — Node 22 has WasmGC and formats correctly.

The major is V8's wasm optimizer: on Node 22, once the module is warm it grows
without bound on it, roughly 100MB/s, until the process is killed. The answers
are right; the process just never exits, which reads as a hang. V8 13 (Node 24)
does not do it, and neither does JavaScriptCore, so bun is fine.

The minor is the wasm exception-handling opcodes. TeaVM emits the final
proposal — `try_table` over `exnref` — which V8 accepts unflagged on Node 22,
rejects on Node 24.0 through 24.14, and accepts again from 24.15.0. On those
releases the module fails to compile rather than misbehaving, and
`--experimental-wasm-exnref` is enough to run it.

The package checks for both and says all this rather than hanging or throwing a
raw `CompileError`. The second check compiles a 28-byte probe module instead of
reading a version number, so bun — which reports a Node version of its own,
below this floor — is judged on what its engine actually does.

## The version it carries

```js
import { googleJavaFormatVersion } from '@scalar/java-fmt'

googleJavaFormatVersion // '1.36.1'
```

"Exact against google-java-format" is a claim about a named release, so the
release is readable rather than something you look up. It is what a consumer
needs to install the matching jar — to verify its own committed bytes in CI, or
to pin a container image — and having it here means that number is not
maintained twice, once in your repository and once in ours.

`src/version.test.ts` reads `GJF_VERSION` out of the build script and fails if
the two ever disagree, so the export cannot go stale across a bump.

## Formatting without awaiting

`formatSync` is for callers with no `await` to give — a code generator that
formats each file inside the synchronous builder that emits it, a template
renderer, a plugin hook that has to return a string.

```js
import { formatSync, init } from '@scalar/java-fmt'

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
import { format, init } from '@scalar/java-fmt'

// Optional. The artifact resolves next to the module by default, which Vite,
// Rollup, webpack and a plain CDN handle unaided. esbuild does not rewrite
// `new URL(..., import.meta.url)`, so there it needs naming.
await init({ url: '/assets/java_fmt.wasm.br' })

await format(source)
```

Run it in a worker. Booting compiles 3.3 MB of wasm, which is a visibly frozen
tab if it happens on the main thread.

The engine floor is checked at boot and is real: the module uses the final wasm
exception-handling opcodes, so Chrome 137, Firefox 131 or Safari 18.4 at the
earliest.

The browser reads the same brotli artifact as Node (0.83 MB over the wire) and
expands it with `DecompressionStream('brotli')` where the engine has it, or a
208 KB wasm decoder where it does not — Chrome, today. Serving the artifact with
`Content-Encoding: br`, or serving an uncompressed `.wasm`, skips the decoder
entirely:

```js
await init({ url: '/assets/java_fmt.wasm', encoding: 'none' })
```

## This is the real google-java-format, and the output is exact

This is **actual [google-java-format](https://github.com/google/google-java-format)
1.36.1** — including javac's own parser, which is what it uses to read Java —
compiled to WebAssembly by [TeaVM](https://teavm.org). It is not a
reimplementation, so it does not drift.

`test/native-conformance.test.ts` asserts byte-identical output against the same
version running on a JVM, in both styles. That test *asserts* rather than
reports: any divergence is a real bug. It skips cleanly when no JVM is around,
so a toolchain-free checkout still passes.

Beyond the samples in that test, the build is checked against 658 real Java
files — the Guava 33.5.0 and google-java-format sources — formatted by both the
wasm build and the native CLI, in both styles. All 1316 comparisons are
byte-identical, and so is a run of the same corpus through the GraalVM Web Image
build of the same version.

### The six patched sites, and why they do not affect that claim

google-java-format supports a range of JDKs, and reaches javac's internals
through reflection wherever their shape has changed between versions. TeaVM
compiles a closed world and cannot serve those probes, so this build replaces
each with the call the probe resolves to on the pinned JDK 21:

| Where | Probe | Replaced with |
|---|---|---|
| `Trees.getEndPosition` | `MethodHandle` chosen by looking for `com.sun.tools.javac.tree.EndPosTable`, removed after [JDK-8372948](https://bugs.openjdk.org/browse/JDK-8372948) | `((JCTree) tree).getEndPosition(((JCCompilationUnit) unit).endPositions)` |
| `JavaInput.buildToks` | `Method` lookup of `DeferredDiagnosticHandler.getDiagnostics` | `diagnostics.getDiagnostics()` |
| `JavaInput.buildToks` | `Constructor` lookup, because the handler is a static class on some JDKs and an inner class on others | `new DeferredDiagnosticHandler(log)` |
| `JavacTokens.getRawCharactersReflectively` | field lookup of `JavaTokenizer.reader`, falling back to the tokenizer | `getRawCharacters(begin, end)` |
| `JavaInputAstVisitor.isModuleImport` | `Method` lookup of `ImportTree.isModule`, added in JDK 23 | `false` |
| `RemoveUnusedImports` | `CaseTree.getLabels`, `JCImport.getQualifiedIdentifier`, `ImportTree.isModule` | direct calls, and `false` for the last |

Each is a *version probe*, not a formatting decision — on JDK 21 there is one
answer and the patch is that answer. That is an argument, though, not evidence,
so the build proves it: the same 658-file corpus is formatted by a stock
`google-java-format-1.36.1-all-deps.jar` and by one carrying these patches, both
on a plain JVM. 658/658 identical. The corpus run above then shows the wasm
matching the *stock* jar, which is the claim that matters.

## `format()` is the CLI, not just the `Formatter` class

Calling `Formatter.formatSource` is the obvious way to wrap this library and it
is not what the tool does. `google-java-format <file>` runs four steps, and the
last three are on by default:

1. `Formatter.formatSource`
2. `RemoveUnusedImports`
3. `ImportOrderer`
4. `StringWrapper` — reflows string literals past the margin

Stopping at step 1 leaves imports untouched and text blocks unreflowed. That is
a visible divergence — the conformance test caught it on a text block sample —
and since the reference this package claims to be is *the tool*, `format()`
replicates all four, in that order.

## One artifact, and how to get it

`build/java_fmt_teavm/build.sh` produces two files, both committed:

- `java_fmt.wasm.br` — the module, 0.82MB brotli-compressed (3.3MB raw)
- `java_fmt.runtime.mjs` — TeaVM's generated runtime, which supplies the
  module's imports and the string and exception bridges

The second one is not glue anyone wrote by hand, and it is not optional: the
module is not standalone and cannot be run by `wasmtime`.

The build needs a **JDK 21**, Maven, git and Node. It fetches TeaVM's source,
google-java-format and Binaryen into a gitignored `toolchain/` directory, so
nothing has to be installed first. Expect about ten minutes cold, most of it
compiling TeaVM. Rerun it when a pin or a patch changes, and commit the result:
the bytes in git are the bytes the tests run against.

**The build compiles a patched TeaVM**, from
[`amritk/teavm`](https://github.com/amritk/teavm) at a pinned commit — the same
one `@scalar/kotlin-fmt` uses. It carries nine class-library additions javac
needs (`String.lines`, `StringBuilder.repeat`, `File.toPath`,
`Spliterators.iterator` and `AbstractSpliterator`, `System.exit`, `IOError`,
`URLClassLoader`, `Normalizer`, `BreakIterator`), four class-library bug fixes,
and Wasm GC backend fixes, each as its own commit with a branch ready to send
upstream. `build/java_fmt_teavm/patches/README.md` lists them. Until they land,
reproducing the artifact means compiling TeaVM. See `.claude/architecture.md` for
the trade-off.

Four of those patches are worth naming, because without them the module builds
and then produces wrong answers or none:

- **`Collectors.joining` dropped empty elements.** It used "is the buffer empty"
  as a proxy for "is this the first element", so an empty first element got no
  delimiter after it and vanished. Splitting text on newlines and joining it
  back is enough to hit that, which is exactly what `StringWrapper` does to
  text blocks — it cost the leading blank line of every one of them.
- **`\R` was rejected outright.** `FormatterException` compiles
  `Pattern.compile("\\R")` in a static initializer, so every syntax error came
  back as a `PatternSyntaxException` instead of the javac diagnostic.
- **`\p{IsAlphabetic}` was unknown**, which broke the javadoc lexer the same way.
- **`java.home` was undefined.** javac's `Locations` class initializer hands it
  straight to `Paths.get`, so the first `format()` in a process threw
  `NullPointerException` — and only the first, because TeaVM marks a class
  initialized even when its initializer throws.

## Things worth knowing before you rely on this

**The module cannot touch the filesystem.** Source goes in as a string and comes
back as a string, which is all this package needs, but it rules out shipping the
CLI itself.

**There is no `wasm-opt` pass.** Binaryen 123 rewrites TeaVM's exception handling
into a form V8 rejects — `type error in branch[0] (expected (ref exn), got
exnref)` — at every optimisation level, so the artifact is TeaVM's `ADVANCED`
output as emitted. It is a quarter the size of the Web Image build anyway.

**google-java-format is not idempotent in `aosp` style.** `StringWrapper`
reflows a long string literal and writes the `+` continuation at a hardcoded
four columns, whatever the style. In `google` that is the continuation indent
anyway; in `aosp` it is not, so a second run re-indents it to eight — and the
tool's own first output is not a fixed point of the tool. It settles on the
second pass. This build reproduces that exactly, at every pass, because it *is*
that build; `test/native-conformance.test.ts` walks both through three passes
and asserts they agree at each one.

Nothing here is needed to see it. One file, one tool:

```java
class Probe {
  void run() {
    x(B.builder().n(B.builder().m("Example Business Solutions for a much longer trailing phrase").build()).build());
  }
}
```

```sh
java -jar google-java-format-1.36.1-all-deps.jar --aosp -i Probe.java
cp Probe.java pass2.java
java -jar google-java-format-1.36.1-all-deps.jar --aosp -i pass2.java
diff -u Probe.java pass2.java   # the jar moved its own `+` from +4 to +8
```

It is worth knowing because of how it shows up. Format here, commit the result,
and then verify in CI with the native jar, and the jar reports a change — which
reads like a wasm-versus-jar divergence and is really pass one against pass two.
A nesting sweep makes that look worse rather than clearer: the eight-column
continuation only survives while it still fits, so a few depths differ and the
ones on either side agree, which reads like this build capping an indent the jar
does not cap. It is not a band in what this build emits. Pass one is the jar's
pass one at every depth, and `test/native-conformance.test.ts` asserts that
across the whole sweep.

How often it bites: 27 of the 658 corpus files are not `aosp` fixed points after
one pass, and all 27 settle on the second. In `google` style none of the 658 do.

Two ways out: format in `google` style, where the hardcoded four is the right
number and the tool is idempotent, or format twice in `aosp` and commit the
second result, which the jar then leaves alone.

**Errors cross the boundary as data.** A Java exception reaching JavaScript
arrives as a proxy object, not an `Error`: it has no message property. So results
carry a one-character status and failures are re-thrown on the JavaScript side,
which is how a syntax error still reports the diagnostic google-java-format
actually produced.

## Community

We are API nerds. You too? Let's chat on Discord: <https://discord.gg/scalar>

## Licensing

The package's own code is MIT. The artifact is not only our code, and the terms
that matter are in `licenses/`:

- google-java-format and its bundled dependencies — Apache-2.0, plus MIT for the
  Checker Framework qualifiers
- TeaVM's class library, compiled into the module — Apache-2.0
- javac's parser, which google-java-format uses to read Java — GPLv2 **with the
  Classpath Exception**

The Classpath Exception is the point. It grants permission to *"link this
library with independent modules to produce an executable, regardless of the
license terms of these independent modules, and to copy and distribute the
resulting executable under terms of your choice"*. That is what this artifact is:
javac's parser linked with google-java-format and TeaVM's class library.

| | |
|---|---|
| Publishing this package free on npm | ✅ |
| Using it in your own build, internally | ✅ |
| A paid hosted service that runs it server-side | ✅ |
| Shipping it inside a product you charge for | ✅ |

The last row is why this build exists. The GraalVM Web Image build in
`build/java_fmt/build.sh` is equally exact and stays for internal and hosted use,
but its artifact embeds Oracle code under the GFTC, which permits redistribution
only where no fee is charged for the artifact or for anything bundling it.
