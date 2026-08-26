---
'@scalar/ruby-fmt': minor
---

Boot from a pre-built VM image instead of loading RuboCop on every start.

Booting was dominated by `require`. Instantiating CRuby costs about half a
second and `require "syntax_tree"` another second, but `require "rubocop"` costs
eight or more - 1266 Ruby files read, parsed, compiled and run on a Ruby that is
itself running on WebAssembly. None of that work depends on the input, the
options, or anything else about the process it happens in, so it is now done
once at build time and shipped as `ruby_fmt.snapshot.br` beside the artifact:
the 625 pages of linear memory the boot changed, 7.9 MB compressed. Booting is
instantiate, grow and copy - **9.2 s to 0.7 s** on a 200-file benchmark, and
formatting one file end to end under plain Node goes from 7.0 s to 2.7 s.

Output is unchanged, and holding it that way is the whole design. The snapshot
is keyed to a fingerprint of the artifact and the restored VM is questioned
before it is trusted, so a missing, stale or unusable image falls back to
running the requires rather than failing. A new `snapshot-equivalence` test
boots both ways and asserts identical bytes, and the two conformance tests
against native syntax_tree and `RuboCop::CLI` still pass.

Two smaller changes ride along:

- The VM now recycles on **growth past its own boot size** (300 MB) rather than
  an absolute 400 MB ceiling. A booted VM holds ~378 MB, so the old ceiling left
  about 20 MB of headroom and a single 38 KB file crossed it - after which every
  later `format` paid for a full recycle.
- The output validity check runs `Ripper#parse` instead of `Ripper.sexp`. Both
  run the same parser and agree exactly on what Ruby accepts, but `sexp` also
  built an S-expression tree nothing looked at.

Browser callers fetch the snapshot too; `init({ snapshot: false })` declines it
and `init({ snapshotUrl })` names it where a bundler has moved it. `rubocop:
false` no longer skips loading RuboCop, because the image always has it - it is
now purely the per-format saving it always also was.
