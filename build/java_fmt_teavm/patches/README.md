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

Upstream `bbc601c` with `../../teavm/patches` applied, with JS, Wasm GC and C,
each optimized and not:

```bash
./gradlew checkstyleMain :tests:test --tests 'org.teavm.vm.*' --tests 'org.teavm.classlib.java.lang.*' --tests 'org.teavm.classlib.java.util.stream.CollectorsTest' --tests 'org.teavm.classlib.java.util.regex.PatternTest' --tests 'org.teavm.classlib.java.util.SpliteratorsTest' --tests 'org.teavm.classlib.java.io.FileTest' --tests 'org.teavm.classlib.java.nio.charset.*' -Pteavm.tests.js=true -Pteavm.tests.wasm-gc=true -Pteavm.tests.c=true -Pteavm.tests.optimized=true
```

Checkstyle passes, and 704 of 707 tests pass. The other three are `FileTest`
cases (`mkdir`, `setReadOnly`, `list_withUnicodeFileName`) that fail identically
on stock upstream in the same container: they create files with CJK names on a
JVM without a UTF-8 locale, and expect a read-only file to be unwritable by
root. The new tests that ship with the fixes (`joining`, the proxy, `\R`,
`\p{IsAlphabetic}`, the class-initializer reproducer) were also run without
their fixes on stock upstream, and each fails there.

That run had a twentieth patch on top, a `br_on_null` reset in the Wasm GC
`WasmTypeInference` that upstream rejected as defensive in the #1224 review. It
has since been dropped: both formatters build to byte-identical modules without
it.

The two packages built on it are the end-to-end check: 658 Java files
byte-identical against google-java-format on a JVM in both styles, and 589 Kotlin
files byte-identical against ktfmt on a JVM in all three.
