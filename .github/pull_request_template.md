<!--
Keep the description focused on the code. See AGENTS.md / CLAUDE.md for the full
contributor guidance this template summarizes.
-->

## What & why

<!-- What does this change do, and what problem does it solve? Link any related issue. -->

## Which packages

<!-- e.g. packages/ruby, packages/java, build/rust_fmt, repo tooling, docs -->

## Exactness

<!--
This repo's central claim. If the change touches a package's output, say what the
reference tool is and how you know the output still matches it — a conformance run,
a corpus comparison, or "no output change" with the reason.

Never upgrade a status to exact without a conformance test that asserts
byte-identical output against the real tool.
-->

## How it was validated

- [ ] `bun run check`
- [ ] `bun run types:check`
- [ ] `bun run test`
- [ ] `bun run test:node` (if a published package's shape or entry point changed)
- [ ] Rebuilt the wasm artifact and re-ran its conformance script (if the build changed)

## Changeset

<!--
Add a changeset (`bunx changeset`) for anything touching a published package. For
docs, tooling and CI changes, add an empty one (`bunx changeset --empty`) so the
PR still records intent. Never pick `major` — every package stays on 0.x.
-->

- [ ] Added a changeset
