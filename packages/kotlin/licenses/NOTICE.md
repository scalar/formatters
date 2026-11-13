# Third-party notices

`kotlin_fmt.wasm.br` is a compiled artifact that **embeds** the software below.
The sources are no longer visible in this tree — they are inside the binary — so
their licenses and attribution notices are reproduced here, as those licenses
require.

Built by `build/kotlin_fmt/build.sh`; the versions are pinned there and in
`build/kotlin_fmt/entry/Cargo.lock`.

## What is in the artifact

| Component | Version | License | Distributed here under |
|---|---|---|---|
| [ktrs](https://github.com/Hexay/ktrs) (`ktrs-fmt`, `ktrs-psi`, `ktrs-parser`, `ktrs-lexer`, `ktrs-syntax`) | 0.5.3 | MIT OR Apache-2.0 | Apache-2.0 |
| [ec4rs](https://github.com/TheDaemoness/ec4rs) | 1.2.0 | Apache-2.0 | Apache-2.0 |
| [text-size](https://github.com/rust-analyzer/text-size) | 1.1.1 | MIT OR Apache-2.0 | Apache-2.0 |
| Rust standard library, including `dlmalloc` 0.2.14 and `compiler_builtins` 0.1.160 | 1.99.1 | MIT OR Apache-2.0 (`compiler_builtins` adds parts under Apache-2.0 WITH LLVM-exception) | Apache-2.0 |

ktrs does not link the tools it reimplements, it ports them. So no Kotlin, JVM
or ktfmt *binary* is in this artifact, but their code is, translated to Rust,
and its Apache-2.0 notices carry over. ktrs's own `NOTICE` names what it ports;
the parts of it that apply to the crates compiled in here are reproduced below.

| Ported from | Into | License |
|---|---|---|
| [Kotlin compiler](https://github.com/JetBrains/kotlin) 2.4.21 — the lexer (`Kotlin.flex`, `KDoc.flex`, with their Unicode character tables), the parser, and the PSI | `ktrs-lexer`, `ktrs-parser`, `ktrs-psi` | Apache-2.0 |
| [IntelliJ Platform](https://github.com/JetBrains/intellij-community) — `PsiBuilder` semantics | `ktrs-parser`, `ktrs-syntax` | Apache-2.0 |
| [ktfmt](https://github.com/facebook/ktfmt) 0.65 | `ktrs-fmt` | Apache-2.0 |
| [google-java-format](https://github.com/google/google-java-format) 1.23.0 — the `Doc`/`Ops` layout engine ktfmt builds on | `ktrs-fmt` | Apache-2.0 |
| [ec4j](https://github.com/ec4j/ec4j) — `.editorconfig` value parsing | `ktrs-fmt` | Apache-2.0 |

The lexer's Unicode character tables are derived from the char maps in the
Kotlin compiler's JFlex-generated lexers, so they come under the Kotlin compiler
entry. JFlex itself places no license on the scanners it generates.

Every component is offered under Apache-2.0, so they share one text:
`apache-2.0-LICENSE`, beside this file.

ktrs's `NOTICE` also credits ktlint, ktfmt-gradle and ktlint-maven-plugin (all
MIT). That code lives in ktrs's linter, Gradle plugin and Maven plugin, none of
which is compiled into this artifact, so their notices are not repeated here.

## Attribution notices

From ktrs's `NOTICE`, as Apache-2.0 §4(d) requires:

```
ktrs
Copyright 2026 ktrs contributors

This product contains code ported from, and test data copied from, the Kotlin
compiler (https://github.com/JetBrains/kotlin), Copyright 2010-2026 JetBrains s.r.o.
and Kotlin Programming Language contributors, licensed under the Apache License 2.0.

This product contains code ported from IntelliJ Platform (PsiBuilder semantics)
(https://github.com/JetBrains/intellij-community), Copyright 2000-2026 JetBrains s.r.o.,
licensed under the Apache License 2.0.

This product contains code ported from, and test data copied from, ktfmt
(https://github.com/facebook/ktfmt), Copyright (c) Meta Platforms, Inc. and affiliates,
licensed under the Apache License 2.0.

This product contains code ported from google-java-format (the Doc/Ops layout engine
ktfmt builds on) (https://github.com/google/google-java-format), Copyright 2015 Google Inc.,
licensed under the Apache License 2.0.

This product contains code ported from ec4j (https://github.com/ec4j/ec4j), Copyright
the ec4j contributors, licensed under the Apache License 2.0.
```

And for the crates linked as they are:

- **ec4rs** 1.2.0: Copyright TheDaemoness and the ec4rs contributors (no copyright line of its own; taken from its authors).
- **text-size** 1.1.1: Copyright Aleksey Kladov, Christopher Durham and the text-size contributors (no copyright line of its own; taken from its authors).
- **Rust standard library** 1.99.1: Copyrights in the Rust project are retained
  by their contributors. The parts of `compiler_builtins` under the LLVM
  exception need no notice in compiled form; they are listed so the omission is
  visible.

## What the terms allow

The artifact is permissively redistributable, including inside a product you
charge for. There is no copyleft component at all, and no JDK code: the sibling
`@scalar/java-fmt` embeds javac (GPLv2 with the Classpath Exception), and this
package never has.

| | |
|---|---|
| Publishing this package free on npm | ✅ |
| Using it in your own build, internally | ✅ |
| A paid hosted service that runs it server-side | ✅ |
| Shipping it inside a product you charge for | ✅ |

The obligations are the usual Apache-2.0 ones: pass on `apache-2.0-LICENSE`
and the attribution notices above with any copy of the artifact, and mark any
changes you make to it.
