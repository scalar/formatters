---
'@scalar/ruby-fmt': minor
---

`format` now runs RuboCop's Layout department after syntax_tree, so its output
is clean under a consumer's own `rubocop` run rather than merely canonical.

**This changes output.** syntax_tree alone leaves Layout offenses in about 30%
of real files — mostly multiline operation and method-call indentation, where
the two tools genuinely disagree — and those files now come back corrected.
Pass `{ rubocop: false }` for the previous behaviour, exactly.

Both tools run because neither does the whole job. syntax_tree reprints: it
discards the input's line breaking and decides it again, which is what makes
formatting idempotent and input-independent. RuboCop never reprints — measured
on 116 files whose formatting differed only in line breaking, RuboCop alone
brought 0 of them to a common result, and syntax_tree brought 91. But
syntax_tree's output is not clean, which is what RuboCop is here to fix. The
order is fixed: running syntax_tree afterwards would revert RuboCop in 116 of
397 files.

The RuboCop half is exactly `rubocop --autocorrect --only Layout`, asserted
byte-identical against `RuboCop::CLI` with both gem versions pinned.

Costs: the artifact grows 3.8 MB → 5.1 MB (RuboCop 1.74.0 and its dependencies
alongside syntax_tree 6.3.0), which every consumer pays. Loading RuboCop into
the VM takes about four seconds on the first call — or during `init`, which now
covers it so `formatSync` does not stall — and each format after that costs two
to three times what syntax_tree alone does. `{ rubocop: false }` skips all of
it: RuboCop is then never loaded.
