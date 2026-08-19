---
'@scalar/kotlin-fmt': minor
'@scalar/java-fmt': minor
---

Stop the Kotlin formatter printing to stderr, and expose the tool version both
packages carry

`@scalar/kotlin-fmt` wrote a Java stack trace to `console.error` once per
process:

```
java.lang.UnsupportedOperationException: LockSupport.park would block the only thread
```

Four lines under bun, forty under Node, where the exception arrives with fake
stack frames attached. It landed on the timer turns *after* the first `format`
resolved rather than during it, so a run that formatted 121 files printed it
once, in the middle of a pass that had succeeded, and it looked like a
diagnostic about the file being formatted. It was not: formatting was correct
throughout.

It came from opening ktfmt's parser. That builds an IntelliJ
`CoreProjectEnvironment`, which launches two coroutines and so starts
kotlinx-coroutines' scheduler, whose workers park waiting for work. Parking is
the one thing a single-threaded wasm runtime cannot do, so each worker died with
an `UnsupportedOperationException` that TeaVM's default handler printed. On a
JVM those same workers park and idle forever; either way the formatting is
finished. The module now installs a handler that drops exactly that — an
`UnsupportedOperationException` whose message is one of the single-threaded
stand-ins refusing — and prints everything else, so a genuine failure on one of
those coroutines is still reported. Output is unchanged: 589 Kotlin files in all
three styles are still byte-identical to ktfmt 0.64 on a JVM.

Both packages also export the version of the tool they carry:

```js
import { ktfmtVersion } from '@scalar/kotlin-fmt'
import { googleJavaFormatVersion } from '@scalar/java-fmt'
```

Exactness is a claim about a named release, and a consumer that re-verifies its
own committed bytes with the native jar needs that release to install the
matching one. Reading it off the package means the number is not pinned twice,
once here and once downstream; a test holds each constant to the version its
build script actually compiles.

One thing documented rather than changed: google-java-format is not idempotent
in `aosp` style on a reflowed string literal — it writes the `+` continuation at
a hardcoded four columns and re-indents to eight on the next run. This build
reproduces that at every pass, because it is that build, so formatting here and
then verifying with the jar compares pass one against pass two and looks like a
divergence that is not one. `packages/java/README.md` has the detail and the two
ways out.
