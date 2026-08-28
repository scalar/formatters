---
'@scalar/ruby-fmt': patch
---

The quadratic term that made formatting a file with a multi-byte character in it cost so much more than the same file without one is gone.

syntax_tree decides whether a comment is inline or stands on its own by walking backwards from the `#` over spaces and tabs, indexing the source string one character at a time. `String#[]` is constant time only while CRuby can treat a string as one byte per character, so a single accented letter anywhere in a file makes every one of those indexes count characters from the start of the string — and a file with a comment above most of its lines does that a great many times: 104,172 of them in one 317 KB file of generated Ruby.

The parser now walks a copy of the source with everything that is not a space, a tab or a newline replaced by `x`. It answers the same three questions the loop asks — tab, space, newline — has the same number of characters so an offset means the same thing in both, and indexes in constant time. It is built once per parse, and not at all for a source that is already ASCII or one whose encoding is invalid.

Like the three `case`/`in` fixes this package already carries, it is applied by reopening the class at boot — it lives in `src/stree-perf-patch.ts`, so the artifact stays stock syntax_tree 6.3.0. Output is unchanged, and two things say so. `test/native-conformance.test.ts` asserts byte-identity against a native syntax_tree 6.3.0 on a source shaped to run through the comment walk. And two corpus comparisons over one generated Ruby SDK — its 441 `.rb` files (5.2 MB) with the RuboCop pass on, its 438 `.rbi` files (6.7 MB) with it off — hash all 879 the same, in 126 s against the 211 s they used to take. The worst file in them, 568 KB carrying two accented characters, goes from 24.1 s to 3.6 s.

This removes the dominant term, not every one. Formatting a large file is still superlinear in its size, and still somewhat slower with a multi-byte character in it than without.
