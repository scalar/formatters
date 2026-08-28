---
'@scalar/ruby-fmt': patch
---

The quadratic term that made formatting a file with a multi-byte character in it cost so much more than the same file without one is gone.

syntax_tree decides whether a comment is inline or stands on its own by walking backwards from the `#` over spaces and tabs, indexing the source string one character at a time. `String#[]` is constant time only while CRuby can treat a string as one byte per character, so a single accented letter anywhere in a file makes every one of those indexes count characters from the start of the string — and a file with a comment above most of its lines does that over a hundred thousand times.

The parser now walks a copy of the source with everything that is not a space, a tab or a newline replaced by `x`. It answers the same three questions the loop asks, has the same number of characters so an offset means the same thing in both, and indexes in constant time. It is built once per parse, and not at all for a source that is already ASCII or one whose encoding is invalid.

Like the three `case`/`in` fixes this package already carries, it is applied by reopening the class at boot — it lives in `src/stree-perf-patch.ts`, so the artifact stays stock syntax_tree 6.3.0. Output is unchanged and the conformance test against native syntax_tree is what says so: 879 files of generated Ruby (12MB, `.rb` through syntax_tree and RuboCop, `.rbi` through syntax_tree alone) format to the same bytes in 126s against 211s. The worst file in that corpus, 568KB carrying two accented characters, goes from 17.4s to 2.7s with the RuboCop pass off.

This removes the dominant term, not every one. Formatting a large file is still superlinear in its size, and still somewhat slower with a multi-byte character in it than without.
