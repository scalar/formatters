# Where `@scalar/java-fmt` and `@scalar/kotlin-fmt` spend their time

Both packages are TeaVM WasmGC builds off one pipeline, so they are measured
together. Everything below was run on the same four-core box, shared with two
other agents, which is why every comparison is a pair of runs taken back to back
rather than a number quoted on its own.

Two engines appear throughout. `bun run bench` uses bun, because that is the
repo's harness; consumers run Node, and Node is materially faster on these
modules, so both are reported wherever the difference matters.

## Summary

- Two changes shipped, both to the Java package. `StringWrapper` returns early
  when it has nothing to reflow — **+69% throughput on bun, 2.04x on the
  conformance corpus under Node**. Three hot `String.matches` call sites became
  compiled patterns — **a further 6.8%**. Boot unchanged by either, output
  byte-identical on 1316 comparisons each time.
- Nothing shipped for the Kotlin package. Its cost is PSI parsing, three to five
  times per file, and no part of it is redundant in a way that can be proved.
- **End to end against the native tools, the wasm build now wins outright on
  Java** — 1.17x to 2.00x at N = 1, 10 and 200 files, across two runs —
  and wins on Kotlin at small N, reaching parity by 200.
- The JS/wasm string boundary is 0.04-0.14% of a format call. It is not the
  problem and there is nothing to fix there.
- `mean` being twice `median` is the corpus's file-size distribution, not
  superlinearity. Cost per byte is flat from 2 KB to 92 KB.
- `optimizationLevel=FULL` buys 8-10% for +55% download and +21-54% boot;
  `strict=false` buys 2-5% for losing catchable exceptions; fixing
  `needWrapping`'s off-by-one buys 1.5%; rewriting the line scan behind it buys
  under 1%. All four were built and measured, all four rejected.

Everything here is reproducible from `perf/`, which is scratch and not committed:
`stages.ts`, `stringwrapper.ts` and `needwrapping.ts` for the pipeline split,
`profile-wasm.mjs` and `profile-tree.mjs` for the CPU profiles, `marshal.mjs` for
the boundary, `exceptions.mjs` for the Throwable count, `steady.mjs` and
`tiering.mjs` for engine comparison, and `native-compare.sh` for section 3. The
benchmark harness itself (`scripts/bench.ts`) belongs to a sibling branch and is
not part of this one.

## 1. Where the time actually goes

### Java

The four CLI steps `format()` replicates can be switched off one at a time from
the JavaScript side, and each option maps to exactly one step inside the module,
so the differences are the steps' own costs. Over the 200-file Guava benchmark
corpus (1819 KB), on bun, against the artifact as it shipped:

| Pipeline | Total | Throughput |
|---|---|---|
| all four steps | 13982 ms | 130 KB/s |
| without `StringWrapper` | 6979 ms | 261 KB/s |
| without `RemoveUnusedImports` | 13374 ms | 136 KB/s |
| without `ImportOrderer` | 14453 ms | 126 KB/s |
| `formatSource` alone | 6221 ms | 292 KB/s |

`StringWrapper` was **half the total**, `RemoveUnusedImports` about 4%, and
`ImportOrderer` nothing measurable. That is the headline, and section 2 is what
came of it.

Inside a single `formatSource`, from a V8 CPU profile of a name-preserving build
(`minifying=false`, 40 Guava files, sampled at 200µs — `perf/profile-wasm.mjs`
and `perf/profile-tree.mjs` reproduce it):

| Share | Where | Note |
|---|---|---|
| 12.7% | `java.util.regex` | TeaVM's own engine. About a quarter of it is *compiling* patterns, not matching them |
| 7.5% | garbage collector | |
| 8.9% | `Array<...>@new` | array allocation, separate from the collector above |
| 9.1% | `java.lang` | mostly `String`/`AbstractStringBuilder` |
| 20.5% | `com.google.googlejavaformat*` | the layout engine and `JavaOutput` |
| 4.7% | `...java.javadoc` | the javadoc lexer, which is what drives most of the regex |
| 7.5% | `com.sun.tools.javac.parser` | javac's lexer and parser |
| 5.9% | `com.sun.tools.javac.util` | `SharedNameTable`, `IntHashTable`, `Convert` |

Rolled up by phase, inclusively: `Trees::parse` 26%, `Doc$Level::computeBreaks`
24%, and `JavadocFormatter::formatJavadoc` **19.5%** — a fifth of every Java
format is reflowing doc comments. `RemoveUnusedImports` shows 13% inclusive here
against 4% from the switch-off table, because the profile is of 40 files and the
table is of 200; take the table as the authority on the pipeline split and the
profile as the authority on what is hot inside a pass.

This is a death-by-a-thousand-cuts profile. There is no single hotspot left
after `StringWrapper`, which is what a ~10x gap against a JIT looks like when the
algorithm is the same on both sides.

### Kotlin

ktfmt's `Formatter.format` is six transforms over a `FormatterContext` that
re-parses whenever a transform changed the code — typically three to five PSI
parses per file, two of them driving google-java-format's layout engine. There is
no equivalent of the `StringWrapper` finding here: no step is disproportionate
and nothing is recomputed that could be skipped by an argument short enough to
check.

The profile says the same thing, and says where the money goes instead
(non-minified build, 40 kotlinx.coroutines files):

| Share | Where |
|---|---|
| 33.2% | IntelliJ PSI (`psi.impl.source.tree`, `lang.impl`, `psi.impl.source`, `psi.impl`, `extapi.psi`) |
| 15.0% | Kotlin parsing and lexing (`parsing`, `lexer`, `kdoc.lexer`) |
| 6.2% | `org.jetbrains.kotlin.psi` |
| 6.8% | google-java-format's layout engine |
| 5.3% | ktfmt itself |
| 12.9% | `java.util` and `java.lang` |
| 3.5% | garbage collector |
| 2.1% | `java.util.regex` |

Inclusively, `LazyParseableElement::ensureParsed` — the PSI tree being built —
is **47%** of a format, reached through the `collectDescendantsOfType<PsiErrorElement>`
scan in ktfmt's `Parser.parse` that forces the whole tree. Kotlin's cost is
parsing, several times over, and that is upstream's design rather than something
this build added. It also means the levers that would help Java most (the regex
engine, at 12.7% there) barely touch Kotlin, at 2.1%.

### What the boundary costs: nothing

The generated runtime is not converting strings a character at a time. TeaVM
compiles the module with `builtins: ["js-string"]` and only installs the
JavaScript `wasm:js-string` shim when the engine refuses them, so on Node and bun
the conversions are engine intrinsics.

Measured directly, by adding a `String -> String` identity export and a
`String -> int` export to the module and timing them against a real format
(`perf/marshal.mjs`):

| Input | round trip | in only | `format` | boundary share |
|---|---|---|---|---|
| 996 B | 0.0152 ms | 0.0030 ms | 10.47 ms | 0.14% |
| 4196 B | 0.0060 ms | 0.0045 ms | 17.18 ms | 0.04% |
| 21796 B | 0.0318 ms | 0.0215 ms | 72.76 ms | 0.04% |
| 93796 B | 0.2551 ms | 0.2023 ms | 446.00 ms | 0.06% |

A 94 KB round trip in 0.26 ms is about 360 MB/s. The boundary is not the
problem, and the probe exports were removed again before the shipped artifact was
built.

### There is no superlinearity

The lead said `mean` being twice `median` on Java pointed at something
superlinear on big files. It does not. Cost per byte is flat:

| Input | `format` | ms per KB |
|---|---|---|
| 2.0 KB | 12.96 ms | 6.6 |
| 4.2 KB | 27.08 ms | 6.6 |
| 10.8 KB | 63.39 ms | 6.0 |
| 21.8 KB | 140.02 ms | 6.6 |
| 44.7 KB | 315.47 ms | 7.1 |
| 91.6 KB | 605.44 ms | 6.6 |

The mean/median gap is the corpus, not the formatter: the Java corpus has a
median file of 4.4 KB and a mean of 9.3 KB, a ratio of 2.1, which is exactly the
ratio the timings show. Per-file cost against file size confirms it — the
slowest files are simply the biggest ones, and the *worst* cost per KB belongs to
the smallest files, which pay a fixed per-call cost of a few milliseconds.

## 2. What changed

### `StringWrapper` returns early when there is nothing to reflow

`StringWrapper.wrap` opens with a fast-path check: does any line exceed the
column limit, or contain a text-block delimiter? The line iterator it asks
(`Newlines.lineIterator`) yields each line **including its trailing break**, so a
line of exactly 100 columns measures 101 and the check says yes. Java formatted
at 100 columns is full of lines that land exactly on the limit.

Counting it on the benchmark corpus: **155 of 200 files take the slow path. Five
of them have anything to reflow.** The other 150 were paying a full extra format
pass and four more parses — two for the reflow scan, two for the AST safety check
— to arrive back at the string they started with.

The patch (`build/java_fmt_teavm/patches/google-java-format.patch`) returns early
when the reflow map comes back empty:

```java
TreeRangeMap<Integer, String> replacements = getReflowReplacements(columnLimit, input);
if (replacements.asMapOfRanges().isEmpty()) {
  return input;
}
```

That is what the rest of the method computes anyway, and the argument is short
enough to check by reading. `formatSource(input, emptyRangeSet)` reaches
`JavaOutput.getFormatReplacements` with an empty token range set, which produces
an empty replacement list, so its result equals its input and the recalculation
below is skipped. `applyReplacements` over an empty map returns `javaInput` by
its own first branch. The AST safety check then parses the input twice and
compares it against itself. Every path returns `input`.

Measured, `bun run bench java`, both against a freshly rebuilt artifact so the
comparison is not against a differently-built module:

| | boot | first | median | mean | p95 | KB/s |
|---|---|---|---|---|---|---|
| before | 225 ms | 387.3 ms | 35.65 ms | 71.49 ms | 253.97 ms | 127 |
| after | 201 ms | 291.9 ms | 21.47 ms | 42.29 ms | 133.48 ms | **215** |

+69% throughput on bun, and boot is unchanged — the module is 2 KB smaller.

On the 658-file conformance corpus under Node 24.15, which is a larger and more
varied body of Java, the same change is worth more:

| Style | before | after |
|---|---|---|
| google | 61.0 ms/file | **29.9 ms/file** |
| aosp | 53.6 ms/file | **32.9 ms/file** |

2.04x and 1.63x.

### Three `String.matches` call sites became compiled patterns

`String.matches(regex)` is specified as `Pattern.matches(regex, this)`, which is
`Pattern.compile(regex).matcher(this).matches()` — the pattern is compiled on
every call and thrown away. google-java-format asks it about every slash-star
comment in the file (`JavaInput.isParamComment`) and about every literal token in
every doc comment (`JavadocLexer.optionalizeSpacesAfterLinks`, and once more in
`deindentPreCodeBlocks`). Hoisting each to a `static final Pattern` is the same
predicate by specification rather than by argument, which is the cheapest kind of
change to be confident about.

It is worth much more here than it would be upstream. Section 1 put 12.7% of a
Java format in `java.util.regex`, and roughly a quarter of that was
`Pattern.compile` reached from `String.matches` — TeaVM's engine is a port of
Apache Harmony's, and compiling on it is expensive.

Measured with `perf/duel.mjs`, which instantiates both artifacts in one process
and alternates them file by file, so a noisy neighbour lands on both sides in the
same proportion. Five rounds over the 200-file corpus:

| | full pipeline | throughput |
|---|---|---|
| before | 24175 ms | 376 KB/s |
| after | 22534 ms | 404 KB/s |

**6.8% faster.** On the 658-file conformance corpus under Node: 29.9 → **27.0**
ms/file in google style, 32.9 → **29.3** in aosp. `bun run bench java` reads 215
→ 236 KB/s, and the same harness on Node reads 370 → 372 — which is the reason
the interleaved figure is the one quoted. A whole-corpus absolute on this box
moves by more than 7% between runs on its own.

Cumulatively with the `StringWrapper` change, against the artifact this branch
started from: 127 → 236 KB/s on bun, 61.0 → 27.0 ms/file on the conformance
corpus.

### Nothing changed for Kotlin

The Kotlin artifact was rebuilt from the same pinned TeaVM and re-cleared
(1767/1767), but no change to it survived screening. Section 5 says what was
tried and section 6 says what would work.

## 3. Against the native tools

Wall clock for one process formatting N files, start-up included on both sides:
the JVM boots and loads the formatter's jar, Node boots, decompresses the
artifact and compiles the module. Neither side is warmed first, because a
consumer's first run is not warmed either. Best of three
(`perf/native-compare.sh`).

| Language | N | wasm (Node 24.15) | native (JVM 21) | wasm advantage |
|---|---|---|---|---|
| Java | 1 | 348 ms | 628 ms | **1.80x** |
| Java | 10 | 832 ms | 1666 ms | **2.00x** |
| Java | 200 | 5256 ms | 6124 ms | **1.17x** |
| Kotlin | 1 | 492 ms | 1228 ms | **2.50x** |
| Kotlin | 10 | 929 ms | 1620 ms | **1.74x** |
| Kotlin | 200 | 7579 ms | 7445 ms | 0.98x |

Re-measured after the pattern hoists shipped, so these are the current artifact.
The earlier run, before that change, read 345/847/6532 ms for Java and
569/1180/6983 for Kotlin against 567/1606/9116 and 1526/2391/4770 native — same
shape, and the difference in the native columns between the two runs is a
reminder of how much the neighbours matter here. Both native CLIs spread their
files over a thread pool sized to the host's processors and this host has four,
so the N=200 row is one core against four *and* the row most exposed to whatever
else is running. Treat the direction as solid and the exact ratio as a range: at
N=200 Java measured 1.17x and 1.40x on the two runs.

**Java is ahead of `google-java-format` end to end at every N, on both runs.**
1.80x and 2.00x at N=1 and N=10, and 1.17x at N=200 on this run against 1.40x on
the previous one. The gap is widest at N=10, where the JVM has paid its start-up
but has not yet tiered up, and narrowest at N=200, where it has tiered up *and*
has four cores to the module's one.

**Kotlin is ahead at small N and lands at parity by 200.** 2.50x at N=1, 1.74x at
N=10, 0.98x at N=200 — where the previous run, on a busier machine, read 0.68x.
Nothing shipped for that package, so the movement is the machine rather than the
formatter, and it is the honest reason not to quote a precise crossover. From the
earlier run, which bracketed it:

| N | wasm | native ktfmt | wasm advantage |
|---|---|---|---|
| 25 | 1431 ms | 2223 ms | 1.55x |
| 50 | 3350 ms | 3723 ms | 1.11x |
| 100 | 4426 ms | 3518 ms | 0.79x |

Somewhere between 50 and 200 files, then, depending on what else the box is
doing. Below that range the wasm module is the faster way to format Kotlin; above
it, ktfmt on a warm JVM with four threads is.

One methodological note that applies to every row above: the input tree is
restaged between runs, outside the timing, so the native tools always see
unformatted input the way the wasm side does. An earlier version of this script
did not, and flattered the JVM by about 25% at N=200.

For reference, steady-state throughput once everything is warm, same corpora:

| Package | engine | boot | median | mean | p95 | KB/s |
|---|---|---|---|---|---|---|
| java | Node 24.15 | 193 ms | 12.62 ms | 24.43 ms | 92.71 ms | 372 |
| java | bun 1.3.11 | 163 ms | 21.16 ms | 38.48 ms | 128.64 ms | 236 |
| kotlin | Node 24.15 | 322 ms | 18.81 ms | 27.23 ms | 67.52 ms | 239 |
| kotlin | bun 1.3.11 | 212 ms | 26.89 ms | 39.90 ms | 101.96 ms | 163 |

These are absolutes on a contended box and they wobble by more than the changes
in section 2 are worth - the Java Node row read 370 KB/s before the pattern
hoists and 372 after, which says nothing except that this is the wrong instrument
for a 7% question. `perf/duel.mjs` is the right one, and it is what section 2
quotes.

**V8 is about 1.5x faster than JavaScriptCore on both modules.** The repo's
`bun run bench` therefore understates what a consumer on Node gets, for both
packages, and the gap is not tiering: five consecutive passes over the corpus on
Node hold at 366-393 KB/s with no trend, while bun drifts the other way (210 KB/s
on the first pass to 181-201 by the fifth). Neither module is stuck in a baseline
tier waiting to be promoted.

## 4. Conformance

Output is unchanged, and the evidence is the repo's own, not a spot check.

| Gate | What it compares | Result |
|---|---|---|
| `bun test packages/java` | 18 tests including `native-conformance` against the stock 1.36.1 jar, both styles | pass |
| `bun test packages/kotlin` | the Kotlin package's tests including `native-conformance` and `quiet` | pass |
| `build/java_fmt_teavm/conformance.sh` step 1 | 658 Guava + google-java-format files, stock jar vs **patched** jar, on a JVM | 658/658 identical |
| `build/java_fmt_teavm/conformance.sh` step 2 | the same 658 files, wasm vs **stock** jar, google and aosp | 658/658 and 658/658 |
| both of the above, re-run after the pattern hoists | same corpus, same comparisons | 658/658 identical, 658/658 and 658/658 |
| `perf/duel.mjs` | the two artifacts side by side on the 200-file benchmark corpus | identical on all 200 |
| `kotlin-probe/gate2.sh` | 589 files, stock ktfmt vs patched ktfmt on a JVM, three styles | 589/589 x3, diagnostics identical |
| `kotlin-probe/conformance.sh` | the same 589 files, wasm vs JVM, three styles | 589/589 x3 |

Step 1 of the Java run is the one that matters for the change made here: it puts
the patched `StringWrapper` and the stock one side by side on a real JVM over 658
files and finds no difference. Step 2 then holds the wasm to the *stock* jar, so
the patch cannot hide inside a self-consistent pair.

## 5. What did not work

### `optimizationLevel=FULL` — 8% faster, and it costs boot

TeaVM's `FULL` differs from `ADVANCED` almost entirely in its inlining strategy:
a smaller per-callee complexity budget but a far larger total growth budget, and
inlining applied across the whole program rather than to once-used callees. It
does make the module faster, and it makes it much bigger.

| | module | boot (bun) | boot (Node) | KB/s (bun) | KB/s (Node) |
|---|---|---|---|---|---|
| `ADVANCED` | 3.32 MB raw, 0.85 MB brotli | 201 ms | 185 ms | 215 | 364 |
| `FULL` | 6.09 MB raw, 1.32 MB brotli | 310 ms | 225 ms | 233 | 401 |

+8% on bun and +10% on Node, against +54% boot on bun, +21% on Node, and +55% on
what every consumer downloads. Boot was not to regress, so this stays at
`ADVANCED`.

### `strict=false` — 2 to 5%, and it would trade away catchable exceptions

TeaVM's strict mode inserts explicit null checks (`beforeInlining`) and array
bound checks (`beforeOptimizations`) into every program. The suspicion was that
these are redundant on WasmGC, where `struct.get` traps on null and `array.get`
traps out of range anyway, and that removing them would be worth real time.

They are nearly free:

| | module | boot (bun) | KB/s (bun) | KB/s (Node) |
|---|---|---|---|---|
| `strict=true` | 3.32 MB raw | 201 ms | 215 | 364 |
| `strict=false` | 2.86 MB raw | 153 ms | 225 | 371 |

+5% on bun, +2% on Node. In exchange, a null dereference anywhere inside
google-java-format would become a wasm trap that kills the module for the rest of
the process instead of a Java NPE that `JavaFmt.format`'s `catch (Throwable)`
turns into a reported diagnostic. The pom's comment already says that is the
trade, and the measurement says the trade is not worth taking. The 14% smaller
module and 48 ms faster boot are the interesting half of this result, and they
are not enough to buy the robustness back.

### The JS/wasm string boundary — ruled out, not improved

This was the lead with the highest prior and it is simply not where the time is:
0.04-0.14% of a format call, measured with purpose-built identity exports (see
section 1). The runtime does carry a character-at-a-time `wasm:js-string` shim -
`fromCharCode`, `concat`, `charCodeAt` implemented as JavaScript closures - but
it is only installed when the engine rejects the js-string builtins, which
neither Node nor bun does. Nothing to fix.

### Eager stack capture on every Throwable — real, and too rare to matter

Every Java `Throwable` TeaVM constructs calls out to JavaScript twice:
`takeStackTrace`, which reads `new Error().stack` and runs a regex over every
line of it, and `decorateException`, which builds a second JS `Error` beside it.
Both are eager even though the result is nominally lazy. At 0.13 ms per
exception that is roughly a hundred times what a JVM charges.

Counting them through the runtime's `installImports` seam
(`perf/exceptions.mjs`): Java constructs 3 Throwables per file, worth 1.9% of the
run; Kotlin constructs **none at all**. Worth knowing, not worth chasing.

### Fixing `needWrapping`'s off-by-one — 1.5%, built and measured

The obvious follow-up to what shipped is to fix the cause rather than shortcut
past the effect: take the trailing line break off the length `needWrapping`
measures, so a line sitting exactly on the limit stops entering the slow path at
all. That saves the reflow scan's javac parse as well, on the 150 files that were
entering for nothing.

It is provably an identity *given* the early return that shipped, which is the
neat part. `LongStringsAndTextBlockScanner` — which decides what goes into the
reflow map — already compares `lineMap.getColumnNumber(lineEnd) - 1`, the count
of characters before the line's newline, against the same limit. So a file whose
every line fits inside the limit yields no long string literals; a text block is
caught by the delimiter test, which never looked at a length; the map is
therefore empty; and an empty map now means `wrap` returns its input. Walking the
slow path and skipping it produce the same string.

It was built and measured. Interleaving the two option settings within one
process, so a noisy neighbour hits both sides equally, `StringWrapper`'s
remaining cost over the corpus goes from 796 ms to 666 ms — **1.5% of a run**,
against the 8-10% predicted.

The prediction was wrong about where the residue was. After the early return,
what `StringWrapper` still costs is not the reflow parse; it is `needWrapping`'s
own scan, which builds a substring per line, runs `String.contains` on each and
now three `endsWith` calls as well. 666 ms over 200 files is about 3.3 ms of line
walking per file, and no change to *when* the scan concludes can remove the scan.

So it was reverted rather than shipped: 1.5% is below this machine's noise floor,
and it would have added an argument-from-two-places to a patch file whose whole
value is that each hunk can be checked by reading it.

There is an asymmetry here worth writing down for whoever tries again, and it is
now recorded at the call site and in both READMEs. The early return that shipped
makes an over-eager `needWrapping` cost a scan and nothing else. An under-eager
one would skip a reflow that was really wanted, and nothing downstream would
catch it — not the corpus, unless the corpus happened to contain that file. Only
the true direction of that predicate may be widened.

### Rewriting `needWrapping`'s line scan — under 1%, built and measured

If the residue is the scan rather than what the scan decides, then rewrite the
scan: walk offsets in the input instead of materialising a substring per line,
and lift the text-block test out of the loop entirely (a `"""` holds no line
terminator, so it cannot straddle two lines — some line contains one exactly when
the input does). The returned boolean stays bit-for-bit what it was, off-by-one
included, which makes it a pure refactor.

It was built, and it was measured two ways. Interleaved against the previous
artifact over three rounds it read 1.7%; over six rounds, 0.43%. Then the patch
was rebuilt carrying only the pattern hoists, and that came out **6.8%** against
the combined build's 6.5% — the same number within noise, which says the scan
rewrite contributed nothing measurable at all.

The reason is that it removed the allocations but not the work. The original
scans every character twice (once in `LineOffsetIterator` to find the breaks,
once in `String.contains` per line) and allocates a substring per line. The
rewrite also scans every character twice — once for `input.contains`, once for
the terminators — and allocates nothing. Only the allocation went, and on a
generational collector that was the cheap part.

Dropped, on the rule that a change under about 2% is patch surface on a vendored
tool rather than a win.



### Superlinearity on large files — there is not any

Covered in section 1: cost per byte is flat from 2 KB to 92 KB, and the
mean/median gap is the corpus's size distribution.


## 6. What is left, and what it would buy

### Upstream, in google-java-format

**Fix `needWrapping`, if upstream wants it for its own sake.** The off-by-one is
real — the length test should not count the line terminator — and the per-line
substring scan behind it is wasteful. Both were built and measured here and
neither paid (section 5), so they are offered as correctness-and-tidiness rather
than as performance. If someone does take them, take them together and in the
right order: the early return has to be in place first, because it is what makes
the predicate's true direction free to widen. Doing the off-by-one without it
would be a silent behaviour change.

**Hoist the recompiled patterns — done here, still wanted upstream.** This
shipped (section 2) and was worth 6.8%. It is an identity by specification, so
there is nothing for upstream to weigh beyond whether they care about the
milliseconds; on a JVM they would be smaller but not zero. The same shape exists
in ktfmt and was left alone on instruction, since a Kotlin cycle is a rebuild
plus a three-style conformance run for a margin the profile puts at 2.1% of the
package's regex time: `KotlinInput.isParamComment` builds a `Regex` per
slash-star comment, and `kdoc/Paragraph.kt` builds `Regex("\\s+")` per paragraph
of KDoc it reflows.

**Memoize `CommentsHelper.rewrite`.** `Doc.Tok.computeBreaks` calls it
unconditionally, and the layout search reaches the same `Tok` at the same column
more than once on levels it has to re-lay-out. `rewrite` is a pure function of
`(tok, maxWidth, column)`, so a cache keyed on those three is an identity. This
one is a guess with a mechanism behind it rather than a measurement — the size of
the win depends on how often the layout search repeats itself, which I did not
get to instrument. `JavadocFormatter::formatJavadoc` is 19.5% of a format, so
the ceiling is high.

### In TeaVM

**`java.util.regex` is 12.7% of a Java format, and about a quarter of that is
pattern compilation.** TeaVM's engine is a port of Apache Harmony's and it is
slow at both halves. Making `Pattern.compile` cheaper, or caching compiled
patterns behind `String.matches`/`String.split`/`String.replaceAll` the way
several other class libraries do, would help every TeaVM program and both of
these packages. This is the single largest identified item that is not
algorithmic.

**Make Throwable's stack capture lazy for real.** `takeStackTrace` already
returns a supplier, but it has read `new Error().stack` and regex-parsed every
frame by the time it does. Deferring both into `getStack()` would cost nothing
and would take the per-exception price from 0.13 ms to near zero. It does not
matter for these two packages — 3 exceptions per Java file, none for Kotlin — but
it is a small, obviously-correct upstream change.

### What could not be done here

**A second Kotlin change.** Each Kotlin cycle is a ~12 minute module compile plus
a ~15 minute three-style conformance run, and the machine has four cores shared
with two other agents. The ktfmt regex hoists above are the change I would make
next; on the evidence from the Java profile they are worth a few percent, not a
factor.

**A `wasm-opt` pass.** Still off the table for the reason the architecture doc
gives: Binaryen 123 rewrites TeaVM's exception handling into a form V8 rejects at
every optimisation level. Nothing here changes that; the wins have to come from
the compiler.

**Anything requiring a TeaVM fork change.** The fork builds from source in about
ten minutes and that is affordable, but a regex-engine change wants its own test
corpus and its own conformance run on both packages before it could be trusted,
which is a day's work rather than an afternoon's. The estimate for it is the
12.7% above, of which perhaps half is recoverable — call it 5-6% on Java and an
unmeasured but probably smaller share on Kotlin, whose profile is flatter.

