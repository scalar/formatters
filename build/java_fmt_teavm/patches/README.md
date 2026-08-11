# Patches

| File | Applied to | Applied by |
|---|---|---|
| `google-java-format.patch` | the `-sources` jar of google-java-format 1.36.1 | `../build.sh` |
| `ktfmt.patch` | the `-sources` jar of ktfmt 0.64 | `../kotlin-probe/ktfmt.sh` |

Both are diffs against a pinned upstream release, so the change stays reviewable
and can be dropped the moment it lands upstream.

## The TeaVM changes live on the fork, not here

They used to be six files in this directory - one of them applied to a different
TeaVM than the others - applied in order with two hunks dropped by hand. They are
now commits on [`amritk/teavm`](https://github.com/amritk/teavm), one per change,
so both builds clone and build rather than clone and patch.

**One toolchain.** Java used to build on 0.14.1 plus `teavm.patch` while Kotlin
built on the fork; both now build on the fork at the same pinned commit. The Java
corpus was re-cleared on it: 658/658 byte-identical in both styles, and the
patch-neutrality half of that run is unchanged at 658/658 too.

### What is on the fork

`master` is base + thirteen commits, in dependency order. Ten are upstreamable
and each has a branch off the upstream base carrying just that change, so a pull
request is a push rather than a rewrite:

| Branch | What |
|---|---|
| `upstream/wasm-gc-coroutine-depth` | a stale `depthBeforeLastInstructionOut`, and per-function coroutine state not reset when a transform fails, which silently corrupted every suspending method compiled afterwards |
| `upstream/wasm-gc-flattened-conditional-type` | `processOptimizedConditional` left the recorded stack holding whatever arm was walked last, where a wasm block leaves the type it is *declared* to produce |
| `upstream/wasm-gc-tee-local-type` | `WasmTypeInference.visit(WasmTeeLocal)` recorded the **value's** type; `local.tee` leaves the **local's declared** type on the stack |
| `upstream/wasm-gc-static-initial-value` | `WasmGCClassGenerator.staticInitialValue` emits a reference null regardless of the global's type |
| `upstream/classlib-fixes` | `Collectors.joining` drops empty elements; `\R` rejected; `\p{IsAlphabetic}` unknown; `java.home` and `user.dir` undefined |
| `upstream/classlib-additions` | `String.lines`, `StringBuilder.repeat`, `File.toPath`, `Spliterators`, `System.exit`, `IOError`, `URLClassLoader`, `Normalizer`, `BreakIterator`. Stacked on `classlib-fixes`: both touch `TSystem` |
| `upstream/system-properties` | `os.version` and `os.arch` undefined |
| `upstream/proxy-and-reflection` | an interface with a constant field cannot be proxied, plus two unnamed reflection exceptions that made it hard to find |
| `upstream/charsets` | UTF-32BE, UTF-32LE, windows-1251, and a `forName` registry keyed by canonical name where the lookup uppercases |
| `upstream/class-init-elimination` | **a miscompile** — `ClassInitElimination` treats any invocation as initializing the class it names, deleting live class initializers |

The first three used to be `claude/…` branches. Those are superseded and can be
deleted; the CLI could not do it from here.

Three commits stay on `master` only, because they are deliberate divergences
rather than fixes:

- **the Kotlin class library** — 47 files of single-threaded `java.util.concurrent`
  stand-ins, `java.lang.management` and `java.beans` declarations, and the
  members the Kotlin compiler reaches for. Includes the `MethodHandle`
  descriptors, `asSpreader` among them: they are spelled out one by one because
  polymorphic-signature methods let the caller write any descriptor, which is
  whack-a-mole rather than something to send upstream.
- **`yield`, `sleep` and `wait` as no-ops or throws** — right for one thread,
  wrong for TeaVM in general. Also what keeps the module a third smaller; see the
  commit message.
- **`RuntimeMXBean`**, which comes with the above.

### Which to send first

`upstream/class-init-elimination`. It is the only one that makes previously
*wrong* code right rather than previously *missing* code present, it is silent,
and any WasmGC program with the shape can hit it. The rest are ordinary gaps.

### Still unreported, with no fix

**The wasm start function can call a coroutine.** TeaVM makes the module
initializer the start function, and the initializer converts `@JSExport` names to
JS strings. If `WasmGCJSRuntime.stringToJs` falls inside the async closure, the
coroutine prologue runs `Fiber.current()` and then `isResuming()` on it — at
instantiation, before any fiber exists — and the module traps on load with
`dereferencing a null pointer`. Any WasmGC program that both uses threads and
exports anything hits this. Found via `../kotlin-probe`, where the closure
covered 7,055 of 20,513 methods. The single-threaded stand-ins avoid it here;
they do not fix it.

**`\P{...}` negation is broken** for every char class implemented as an anonymous
`AbstractCharClass` overriding `contains(int)`. `\P{javaJavaIdentifierStart}`
fails to match `"1"`, and so does `\P{IsAlphabetic}` after `classlib-fixes`;
`\P{Alpha}`, built from a `CharClass` instead, is fine. It predates all of this
and fixing it means changing how the engine composes negation with the
supplementary-codepoint split, so the test on that branch deliberately does not
assert the negated form.

## One fix that did not survive the move, and should not have

**`WasmGCResourcesIntrinsic` emits an unloadable module.** On 0.14.1 it creates
the `teavm@resourcesBaseAddress` global unconditionally but only initialises it
in `writeModule`, which returns early when no resource bytes were collected — so
the module carries a global with an empty constant expression and no engine will
load it. `teavm.patch` seeded it at creation, as the string-pool intrinsic
already does.

Master fixes it the other way, seeding the global in that early return. Applying
both gives the global two initializers and a module unloadable for the opposite
reason, which is why it is not on the fork and why moving Java to master made the
hunk disappear rather than move. It cost a build cycle once, looking like a new
master-only bug; it was our patch applied twice.

## How the TeaVM changes were verified

TeaVM's own JUnit runner drives a browser, which this environment cannot start.
Two things stand in for it.

The class-library assertions were run as a Wasm GC module under Node
(`../toolchain/classlib-probe`) and, unchanged, on a real JVM. Both report ALL
PASS, which is the point: the tests encode Java's semantics, not TeaVM's. That
second run caught an assertion that `AbstractSpliterator.trySplit()` returns
null — true of this implementation, false of the JDK's, and therefore wrong to
assert in a conformance suite.

The backend changes are checked by the two packages built on them: 658 Java files
byte-identical against google-java-format on a JVM, and 589 Kotlin files in three
styles byte-identical against ktfmt on a JVM. `class-init-elimination` in
particular has no unit-sized reproducer and is checked only that way.
