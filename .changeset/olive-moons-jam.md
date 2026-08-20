---
'@scalar/ruby-fmt': minor
---

The bundled RuboCop moves from 1.74.0 to 1.81.6, and the CRuby it runs on from
3.4.1 to 4.0.0.

**This changes output**, in the direction of fewer Layout offenses left behind.
Two of them are offenses syntax_tree's own output introduces, so the
`--only Layout` pass was always the thing that should have been clearing them,
and 1.74.0 simply did not:

- `Layout/SpaceInsideHashLiteralBraces` now applies to hash *patterns*, not only
  hash literals. `in { event: "error", data: String => data }` was left
  untouched by an `EnforcedStyle: no_space` config that corrected the identical
  literal.
- `Layout/SpaceAroundKeyword` now flags the `return(` that syntax_tree emits
  when a `return <call>` has to wrap, so it comes back as `return (`.

The CRuby bump is the price of the RuboCop bump rather than a separate change.
RuboCop 1.75 and later need `rubocop-ast` 1.43+, which subclasses prism's parser
translation while it is being required — prism has to exist before the first cop
is registered, whether or not the pass ever parses with it. That translation
needs prism 1.4, and `rubocop-ast` 1.49 raised the floor again to 1.7. A prism
gem cannot supply it, because a static wasm build resolves `require
"prism/prism"` from the built-in extension table before `$LOAD_PATH`. Ruby 3.4.1
compiles in prism 1.2.0; Ruby 4.0.0 compiles in 1.7.0.

syntax_tree stays at 6.3.0 and its output is unaffected by the newer Ruby:
formatting 1,200 files of real Ruby through syntax_tree 6.3.0 on 3.x and on
4.0.0 gives byte-identical results, which is the property the "exact" claim
rests on. `TargetRubyVersion` for the RuboCop pass is unchanged at 3.4 — it
describes the Ruby a consumer is writing for, not the one inside the artifact.

Two things inside the VM had to move with the Ruby. RubyGems is now required
explicitly, because Ruby 4.0 stopped loading it during startup and syntax_tree
reaches for `Gem::Version` on the second line of its formatter. And the VM
registers a minimal gemspec for each gem in `/bundle` before requiring RuboCop,
because rbwasm packages the bundle as `$LOAD_PATH` entries with no
specifications at all — with none to find, prism's parser translation answers
its own `gem "parser", ">= 3.3.7.2"` with `exit(1)`.

The artifact grows 5.1 MB → 5.2 MB: a larger CRuby, and prism's Ruby files,
which the build used to strip because nothing loaded them.

CI now installs Ruby 4.0 so that both conformance tests keep comparing against
the same versions the artifact carries.
