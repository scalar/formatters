---
---

Run the Ruby conformance test in CI instead of skipping it.

Every `native-conformance.test.ts` in the repo gates itself on the reference
tool being installed, and CI installs only Bun — so the tests that back the
`exact` claims have never run there. Ruby is the one that is cheap to fix:
syntax_tree is pure Ruby and installs in seconds, where the others want a .NET
SDK, a Rust nightly or a JDK.

The Test Suite job now sets up Ruby 3.4 — the version the artifact is built
from, because Ripper comes from CRuby rather than from the gem — and installs
the syntax_tree version read out of `build/ruby_fmt/Gemfile`, so there is no
second place to keep the pin. The test reads that same pin and skips rather than
compares when what is installed does not match it, which keeps a stray gem from
failing the build for the wrong reason.
