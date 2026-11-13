# Third-party notices

`java_fmt.wasm.br` and `java_fmt.runtime.mjs` are compiled artifacts that
**embed** the software below. The sources are no longer visible in this tree —
they are inside the binary — so their licenses are reproduced here, as those
licenses require.

Built by `build/java_fmt_teavm/build.sh`; the versions are pinned at the top of
it.

| Component | Version | License | Text |
|---|---|---|---|
| google-java-format | 1.36.1 | Apache-2.0 | `apache-2.0-LICENSE` |
| Guava | bundled with the above | Apache-2.0 | `apache-2.0-LICENSE` |
| Checker Framework qualifiers | bundled with the above | MIT | `checker-qual-LICENSE` |
| commonmark-java (`commonmark`, `commonmark-ext-gfm-tables`) | 0.28.0, bundled with the above | BSD-2-Clause | `commonmark-LICENSE` |
| JSpecify, Error Prone and J2ObjC annotations | bundled with the above | Apache-2.0 | `apache-2.0-LICENSE` |
| TeaVM class library and runtime | master + patches, see `build/teavm/UPSTREAM_REF` | Apache-2.0 | `apache-2.0-LICENSE`, `teavm-NOTICE` |
| `java.*` shims for TeaVM (`build/teavm/shims`) | this repository | Apache-2.0 | `apache-2.0-LICENSE` |
| javac (`java.compiler`, `jdk.compiler`) | OpenJDK 21 | GPLv2 with the Classpath Exception | `openjdk-GPLv2`, `openjdk-ADDITIONAL_LICENSE_INFO`, `openjdk-ASSEMBLY_EXCEPTION` |

The Apache-2.0 entries share one text: google-java-format ships its dependencies
shaded into a single `-all-deps` jar, which carries exactly one copy of the
license, and TeaVM is under the same license.

**commonmark-java** is how google-java-format reads Markdown doc comments
(`///`), and its classes are in the module. That jar carries no license file for
it, so `commonmark-LICENSE` is taken from commonmark-java's own repository at the
tagged release. Its BSD-2-Clause terms ask that a binary distribution reproduce
the copyright notice, conditions and disclaimer, which that file does.

**TeaVM ships a `NOTICE` file**, and Apache-2.0 §4(d) asks that a distribution
carry it. `teavm-NOTICE` is that file at the pinned upstream commit. It credits
Alexey Andreev, the Apache Software Foundation (TeaVM's class library descends
from Apache Harmony) and Joda.org.

The annotation libraries are listed because their class names appear in the
module's metadata. Their annotations are not executable code.

## What the terms allow

The artifact is permissively redistributable, including inside a product you
charge for.

Everything in it is Apache-2.0, MIT or BSD-2-Clause except javac's parser, which google-java-format
uses to read Java. That is OpenJDK code under **GPLv2 with the Classpath
Exception**, and the exception exists for exactly this case — Oracle's own
description of it, from `openjdk-ADDITIONAL_LICENSE_INFO`:

> Oracle facilitates your further distribution of this package by adding the
> Classpath Exception to the necessary parts of its GPLv2 code, which permits
> you to use that code in combination with other independent modules not
> licensed under the GPLv2.

The independent modules here are google-java-format and TeaVM's class library,
both Apache-2.0, and the libraries bundled with them, and the combination is the
wasm module. The three OpenJDK texts
alongside this file are the ones the JDK itself ships in `legal/`: the GPLv2, the
clarification above, and the assembly exception.

Note the limit Oracle draws in the same file: the exception covers *combining*
GPLv2 code with independent modules, not commingling — it does not permit
copying OpenJDK code into a file of your own. This build does not; javac is used
as the JDK ships it.

What that permits, concretely:

| | |
|---|---|
| Publishing this package free on npm | ✅ |
| Using it in your own build, internally | ✅ |
| A paid hosted service that runs it server-side | ✅ |
| Shipping it inside a product you charge for | ✅ |

## Modifications, as the licenses require

Both Apache-2.0 and the GPL ask that modified files be marked. Neither
google-java-format nor TeaVM is shipped unmodified here:

- **google-java-format 1.36.1** — six reflective JDK-version probes replaced
  with the call each resolves to on JDK 21, in `Trees`, `JavaInput` (two),
  `JavacTokens`, `JavaInputAstVisitor` and `RemoveUnusedImports`. The diff is
  `build/java_fmt_teavm/patches/google-java-format.patch`, and the package
  README lists the sites individually.
- **TeaVM** — upstream at a pinned commit with a patch series applied
  (class-library additions and bug fixes, and a class-initializer fix), plus a
  jar of `java.*` classes upstream lacks; `build/teavm/README.md` lists them.
- **javac** — unmodified. It is used as the JDK ships it, with a handful of
  JDK-internal classes it references supplied as stubs that throw
  (`build/java_fmt_teavm/stubs/`), because nothing on the formatter's path calls
  them.

## The other pipeline

`build/java_fmt/build.sh` builds the same formatter with Oracle GraalVM Web
Image. That artifact is not the one this package ships, because it embeds Oracle
code under the GraalVM Free Terms and Conditions, which permits redistribution
only where no fee is charged for the artifact or for a product bundling it. It
remains in the repository for internal and hosted use, where those terms are
satisfied, and as an independent check on this one: both are compared against
the same corpus.
