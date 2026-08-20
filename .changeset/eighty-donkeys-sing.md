---
'@scalar/ruby-fmt': patch
---

Fixes three syntax_tree 6.3.0 pattern-matching bugs that made `format` reject
whole files.

All three produce Ruby that does not parse from input that did, so the re-parse
guard `format` runs was throwing rather than writing a broken file. The guard
was right; the fixes are what was missing. They live in `src/stree-patch.ts`
alongside the endless-range fix that was already there, applied by reopening the
classes at boot, so the artifact stays stock syntax_tree 6.3.0.

**A guarded clause lost the parentheses that make it legal.** `in (400..) if g`
came back as `in 400 ..  if g` — `unexpected 'if', expecting 'then'`. The
parentheses are the only legal spelling here, because the guard already occupies
the place `then` would go, and syntax_tree recorded no trace of them. Writing
`then` defensively in the input did not survive either. A guarded pattern that
does not terminate itself is now wrapped back in parentheses, and a hash pattern
inside them keeps its braces — `in {x: (500..)} if g` comes back as
`in ({ x: 500.. }) if g`, since `in (x: 500..)` does not parse.

**` then` was printed inside a hash pattern's braces.** `in {a: 1, **}` came
back as `in { a: 1, ** then }` — `unexpected 'then', expecting '}'`. The braces
already do the job that `then` was there for, so it is now printed only in the
one rendering that has none, `in ** then`.

**An exponent earlier in the file was adopted as a hash pattern's `**`.** A
`n**2` anywhere above a `case`/`in` left an `Op` token that the pattern's
unbounded reverse search claimed as its own, so `in {a: 1, b: 2}` came back as
`in { a: 1, b: 2, ** then }`. The search now has a floor: the pattern's own `**`
is the last thing in it, so it must start after the pattern's constant, keywords
and opening brace. That refuses a pin expression's exponent too
(`in { a: ^(n**2), b: 2 }`). One shape in this family parsed and meant something
else — `in {}` after an exponent became `in **`, which matches any hash rather
than only an empty one.

Spacing the exponent as `n ** 2` used to dodge this, but syntax_tree normalises
it straight back to `n**2`, so the workaround did not survive a second run.
Nothing else changes: over 2,076 files of real Ruby the fixes alter the output
of none of them.

Also documents a hazard that is not this package's bug: RuboCop's
`Style/MultilineInPatternThen` removes the `then` that a pattern ending in an
endless range cannot do without, and the result does not parse. The Layout pass
here never runs it, but a consumer running a full `rubocop -a` afterwards
should turn that cop off. See the package README.
