---
'@scalar/java-fmt': patch
---

Document the `aosp` reflow quirk as google-java-format's own non-idempotence, and assert it in CI

Formatting with this package and then re-checking the result with the native jar
reports a change on a reflowed long string literal in `aosp` style. That is the
jar disagreeing with itself, not this build disagreeing with the jar:
`StringWrapper` writes the `+` continuation at a hardcoded four columns whatever
the style, and a second run re-indents it to the eight `aosp` uses. The
conformance test now sweeps the nesting depth and asserts pass one is
byte-identical to the jar's pass one at every depth, and pins which depths the
jar re-indents so an upstream fix surfaces here. The READMEs gain a
reproduction that uses only the jar, and the corpus numbers behind the
format-twice workaround.
