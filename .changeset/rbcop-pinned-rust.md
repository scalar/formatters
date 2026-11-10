---
"@scalar/ruby-fmt": patch
---

The rbcop artifact is rebuilt with Rust 1.99.1. That is now pinned in the repo's `rust-toolchain.toml` and shared with the rustfmt build; before, the build used whichever stable Rust was installed. rbcop itself is unchanged, and `test/rubocop-conformance.test.ts` still asserts byte-identical output against native RuboCop 1.92.2, including over RuboCop's own 957 source files.
