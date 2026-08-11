# Project rules

Developer guidelines live in the `.claude/` directory:

- **bun.md** — Bun runtime, APIs, testing
- **typescript.md** — TypeScript style, principles, naming
- **comments.md** — Comment guidelines and JSDoc
- **testing.md** — Test setup, style, and examples
- **architecture.md** — Repo structure and the exactness rule

## The one rule that governs this repo

**Formatting must work with nothing installed but Node.** No JVM, no Ruby, no
Swift toolchain, no native binaries. Bun is the development toolchain — package
manager, test runner, script runner — but nothing a published package does at
runtime may depend on it. `bun run test:node` exists to keep that honest: it
loads each package and formats through it under plain Node.

## Exactness is a claim about a named tool

A package is "exact" only when it *is* the reference tool compiled to wasm, not
a reimplementation of it. Reimplementations drift, and the drift is invisible
until a consumer's CI fails. When a package is not exact, the README says so in
the status table and the package README explains what diverges and why. Do not
upgrade a status to exact without a conformance test that asserts byte-identical
output against the real tool.

## Changesets

Add a changeset with every PR. Run `bunx changeset`, pick the affected packages
and an appropriate semver bump, and commit the generated file under
`.changeset/`. For changes that do not touch any published package (docs,
tooling, CI), create an empty changeset (`bunx changeset --empty`) so the PR
still records intent.

Never pick `major`. Every package stays on the `0.x` line, and changesets
resolves a `major` on a `0.x` package to `1.0.0` rather than `0.(x+1).0` — so a
single one silently takes a package to 1.0. A breaking change gets `minor`; say
what breaks in the summary, which is where consumers read it anyway.

## Git & PR Guidelines

NEVER include Claude session links, tracking IDs, or platform attributions in commits or PR text. Keep all PR descriptions strictly focused on the code changes.
