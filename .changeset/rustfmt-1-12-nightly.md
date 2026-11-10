---
"@scalar/rust-fmt": minor
---

The bundled rustfmt moves from 1.10.0-nightly (`nightly-2026-09-22`, rust-lang/rust `1303417c4`) to 1.12.0-nightly (`nightly-2026-11-10`, `ac8310ba6`). **This can change output.** rustfmt's formatting depends on the compiler it parses with, so a consumer comparing against a native `rustfmt` in CI should move to the same nightly. `test/native-conformance.test.ts` asserts byte-identical output against `rustfmt 1.12.0-nightly (ac8310ba64 2026-11-09)` and passes, as does every one of the 815 files under rustfmt's own `tests/source`.

The build's one patch to rustfmt needed new context: `main` now calls `setup_tracing()` where it used to build the subscriber inline. The patch itself is unchanged.
