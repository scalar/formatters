# Third-party notices

`kotlin_fmt.wasm.br` and `kotlin_fmt.runtime.mjs` are compiled artifacts that
**embed** the software below. The sources are no longer visible in this tree —
they are inside the binary — so their licenses are reproduced here, as those
licenses require.

Built by `build/java_fmt_teavm/kotlin-probe/build.sh`; the versions are pinned at
the top of it.

| Component | Version | License | Text |
|---|---|---|---|
| ktfmt | 0.64 | Apache-2.0 | `apache-2.0-LICENSE` |
| Kotlin compiler (PSI and parser, `kotlin-compiler-embeddable`) | 2.3.20 | Apache-2.0 | `apache-2.0-LICENSE` |
| IntelliJ platform (shaded inside the above) | bundled with the above | Apache-2.0 | `apache-2.0-LICENSE` |
| Kotlin standard library | 2.3.20 | Apache-2.0 | `apache-2.0-LICENSE` |
| kotlinx-coroutines (`kotlinx-coroutines-core-jvm`) | 1.10.2 | Apache-2.0 | `apache-2.0-LICENSE` |
| google-java-format (layout engine only) | 1.23.0 | Apache-2.0 | `apache-2.0-LICENSE` |
| Guava | 33.5.0-jre | Apache-2.0 | `apache-2.0-LICENSE` |
| TeaVM class library and runtime | master + patches, see `build/teavm/UPSTREAM_REF` | Apache-2.0 | `apache-2.0-LICENSE` |

Every entry is Apache-2.0, so they share one text.

## What the terms allow

The artifact is permissively redistributable, including inside a product you
charge for. There is no copyleft component at all.

That is worth stating plainly because the sibling package is not in the same
position: `@scalar/java-fmt` embeds javac, which is GPLv2 with the Classpath
Exception. This one embeds no JDK internals — ktfmt reads Kotlin with the Kotlin
compiler's own PSI, and uses google-java-format only for its layout engine
(`Doc`, `DocBuilder`), not its Java parser. javac is not in this module.

| | |
|---|---|
| Publishing this package free on npm | ✅ |
| Using it in your own build, internally | ✅ |
| A paid hosted service that runs it server-side | ✅ |
| Shipping it inside a product you charge for | ✅ |

## Modifications, as the license requires

Apache-2.0 asks that modified files be marked. These components are not shipped
unmodified:

- **ktfmt 0.64** — the initializer of `Parser` builds a bare PSI container
  instead of a `KotlinCoreEnvironment`. One file, ~20 lines; everything else is
  ktfmt's. The diff is `build/java_fmt_teavm/patches/ktfmt.patch`, and
  `gate2.sh` is the evidence that it changes no output.
- **TeaVM** — upstream at a pinned commit with a patch series applied
  (class-library additions and fixes, a proxy fix, three charsets and a
  class-initializer miscompile fix), plus a jar of single-threaded `java.*`
  classes upstream lacks. All of it is in `build/teavm/`, with
  `build/teavm/README.md` explaining each part.
- **kotlinx-coroutines 1.10.2 and the IntelliJ platform** — one call deleted
  from each of three classes at build time, by
  `build/java_fmt_teavm/kotlin-probe/plugin/kprobe/SingleThreadedCalls.java`:
  `Thread.yield()` from `kotlinx.coroutines.scheduling.WorkQueue` and from
  IntelliJ's `ConcurrentIntObjectHashMap`, and `Thread.sleep` from IntelliJ's
  `TimeoutUtil`. None is on a path formatting takes; see that file for why.

The Kotlin standard library, google-java-format and Guava are used as published.
