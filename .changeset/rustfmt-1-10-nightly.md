---
"@scalar/rust-fmt": minor
---

The bundled rustfmt moves from 1.9.0-nightly (`nightly-2026-07-19`, rust-lang/rust `eff8269f7`) to 1.10.0-nightly (`nightly-2026-09-22`, `1303417c4`). **This can change output.** rustfmt's formatting depends on the compiler it parses with, so a consumer comparing against a native `rustfmt` in CI should move to the same nightly. `test/native-conformance.test.ts` asserts byte-identical output against `rustfmt 1.10.0-nightly (1303417c41 2026-09-21)`, and passes.

The build script also needed three changes for the newer nightly. Cargo now gives each unit its own `build/<package>/<hash>/out/` directory instead of one shared `deps/`, and builds rlibs with their metadata split out into a sibling `.rmeta`. rustfmt now also links `rustc_feature`.
