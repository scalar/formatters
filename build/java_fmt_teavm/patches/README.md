# Patches

| File | Applied to | Applied by |
|---|---|---|
| `google-java-format.patch` | the `-sources` jar of google-java-format 1.36.1 | `../build.sh` |
| `ktfmt.patch` | the `-sources` jar of ktfmt 0.64 | `../kotlin-probe/ktfmt.sh` |

Both are diffs against a pinned upstream release, so the change stays reviewable
and can be dropped the moment it lands upstream.

## The TeaVM changes live in `../../teavm`

They were six patch files here, then commits on the `amritk/teavm` fork. They are
now a patch series and a shims jar applied to a pinned upstream
`konsoletyper/teavm` commit, in [`../../teavm`](../../teavm/README.md):

- `patches/` - the edits to classes and compiler code upstream already has, one
  change per patch, the upstreamable ones first;
- `shims/` - the `java.*` classes upstream does not define (the single-threaded
  `java.util.concurrent` stand-ins, `java.lang.management`, `IOError`,
  `URLClassLoader`, `Normalizer`, `BreakIterator`, ...), loaded through TeaVM's
  substitution extension point instead of living in its class library;
- `HUNKS.md` - where every hunk of the fork's diff went;
- `upstream/` - drafts of the PRs and issues to send.

Both builds call `../../teavm/apply.sh`, so Java and Kotlin still compile with one
TeaVM.

### Still unreported, with no fix

**The wasm start function can call a coroutine.** TeaVM makes the module
initializer the start function, and the initializer converts `@JSExport` names to
JS strings. If `WasmGCJSRuntime.stringToJs` falls inside the async closure, the
coroutine prologue runs `Fiber.current()` and then `isResuming()` on it — at
instantiation, before any fiber exists — and the module traps on load with
`dereferencing a null pointer`. Any WasmGC program that both uses threads and
exports anything hits this. Found via `../kotlin-probe`, where the closure
covered 7,055 of 20,513 methods. Upstream's async-off default avoids it here,
since nothing is coroutine-transformed; it does not fix it.

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
