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
byte-identical against `RuboCop::CLI` with the gem versions pinned.

Two options come with it. `rubocopConfig` takes extra `.rubocop.yml` entries,
merged over the ones this package sets — the escape hatch for the rest of
RuboCop's configuration. And `init({ rubocop: false })` lets a synchronous
caller leave RuboCop unloaded, which `formatSync` otherwise could not do because
it requires `init`.

`Layout/LineLength` is off, because `printWidth` belongs to syntax_tree: it is
the tool that reprints, so it is the one that can honour a width. With the cop
on at its default `Max: 120`, `{ printWidth: 200 }` came back rewrapped at 124 —
neither width. Disabling it changes none of 397 corpus files at the default
width; `rubocopConfig` puts it back for anyone who wants it.

Costs: the artifact grows 3.8 MB → 5.1 MB (RuboCop 1.74.0 and its dependencies
alongside syntax_tree 6.3.0), which every consumer pays. Loading RuboCop into
the VM takes about four seconds on the first call — or during `init`, which now
covers it so `formatSync` does not stall — and each format after that costs two
to three times what syntax_tree alone does. `{ rubocop: false }` skips all of
it: RuboCop is then never loaded.
