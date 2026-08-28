---
'@scalar/ruby-fmt': patch
---

Formatting a file that contains a multi-byte character is no longer quadratic in the size of that file.

syntax_tree decides whether a comment is inline or stands on its own by walking backwards from the `#` over spaces and tabs, indexing the source string one character at a time. `String#[]` is constant time only while CRuby can treat a string as one byte per character, so a single accented letter anywhere in a file makes every one of those indexes count characters from the start of the string — and a file with a comment above most of its lines does that tens of thousands of times.

The parser now walks a copy of the source with everything that is not a space, a tab or a newline replaced by `x`. It answers the same three questions the loop asks, has the same number of characters so an offset means the same thing in both, and indexes in constant time. It is built once per parse, and not at all for a source that is already ASCII or one whose encoding is invalid.

Output is unchanged: 879 files of generated Ruby (12MB, `.rb` through syntax_tree and RuboCop, `.rbi` through syntax_tree alone) format to the same bytes in 40% less time — 211s to 126s. The worst file in that corpus, 568KB carrying two accented characters, goes from 17.4s to 2.7s.
