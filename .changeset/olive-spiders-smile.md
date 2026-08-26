---
"@scalar/java-fmt": patch
---

Compile three hot regular expressions once instead of once per call, for another
6.5% off `format`, with byte-identical output.

google-java-format asks `String.matches` about every slash-star comment in a file
(`JavaInput.isParamComment`) and about every literal token in every doc comment
(`JavadocLexer`). `String.matches(regex)` is specified as
`Pattern.matches(regex, this)`, so each of those calls was compiling its regular
expression from scratch and throwing it away. They are now `static final Pattern`
constants, which is the same predicate by definition.

That costs upstream very little and costs this package a lot, because the
compiled artifact carries TeaVM's `java.util.regex` — a port of Apache Harmony's
engine — where compiling a pattern is expensive enough to have been a quarter of
all the time a Java format spent on regular expressions.

Measured by running the previous artifact and this one side by side in a single
process, alternating file by file so a busy machine could not flatter either:
6.8% faster over 200 Guava files. On the 658-file conformance corpus under Node,
29.9 ms to 27.0 ms per file. Both corpora still come back byte-identical to
google-java-format on a JVM — 658/658 in each style.
