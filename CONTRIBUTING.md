# Contributing

Thanks for taking the time. This repo has one hard constraint and one design rule, and most of
what follows is downstream of them.

**Formatting must work with nothing installed but Node.** No JVM, no Ruby, no Swift toolchain,
no .NET SDK, no PHP, no native binaries, no postinstall downloads. Bun is the development
toolchain — package manager, test runner, script runner — but nothing a published package does
at runtime may depend on it.

**Exactness is a claim about a named tool.** A package is *exact* only when it **is** the
reference tool compiled to WebAssembly, not a reimplementation of it. Reimplementations drift,
and the drift stays invisible until a consumer's CI runs the real tool in `--check` mode and
fails. Never upgrade a status to exact without a conformance test that asserts byte-identical
output against the real tool.

## Getting set up

You need [Bun](https://bun.sh) and Node 24.15 or newer — `bun run test:node` loads the Java and
Kotlin artifacts, and Node 24.0 through 24.14 will not compile them. The repo pins 26.7.0 in
`.nvmrc` and installs that in CI, so `nvm use` gets you the Node everything is developed against;
24.15 is only the floor, and CI runs both ends. Nothing else — the wasm artifacts are committed,
so a fresh clone builds and tests without any language toolchain.

```bash
bun install
bun run build       # compile each package's src/ to dist/
bun run test        # the bun test suite
bun run test:node   # build, then load every package under plain Node
bun run types:check # tsc --noEmit over sources, tests and repo scripts
bun run check       # biome lint + format check
bun run format      # biome, write mode (also runs on commit via lefthook)
```

`bun run ci` runs the same set CI does. Conformance tests skip cleanly when the native tool
they compare against is absent, so a toolchain-free checkout still passes green.

## Where things live

```
build/        build pipelines for the wasm artifacts
packages/     published npm packages, one per language
  <pkg>/src/  TypeScript sources, one function per file
  <pkg>/dist/ compiled output — what consumers import (gitignored)
  <pkg>/test/ integration tests and the plain-Node smoke test
scripts/      repo tooling
```

[`.claude/architecture.md`](./.claude/architecture.md) is the long version: the repo layout, the
exactness rule, and a section per package recording what is load-bearing in its build and why.
Read the section for the package you are touching before you change its pipeline — most of the
non-obvious flags in there are there because removing them broke something in a way that took a
while to find. The rest of [`.claude/`](./.claude/) covers TypeScript style, comments, testing
and Bun; [`AGENTS.md`](./AGENTS.md) is the same guidance addressed to AI coding agents.

## Changing a package

- Match the surrounding code's style, comment density and naming. Biome (`biome.json`) is the
  formatter and linter.
- If output can change, say how you know it did not — a conformance run, a corpus comparison,
  or "no output change" with the reason. The pull request template asks for exactly this.
- Rebuilding a wasm artifact needs that language's toolchain, and the build scripts download
  what they can themselves (`bun run ruby:build`, `java:build:teavm`, `csharp:build`,
  `swift:build`, `php:build`, `rust:build`). Artifacts are committed, so the rebuilt bytes go
  in the same commit as the change that motivated them.
- Third-party sources under `packages/*/vendor/` are copied verbatim and pinned in a
  `VERSIONS.json`. Re-vendor and bump the pin; never hand-edit them.

## Changesets

Every pull request carries one — CI fails without it.

```bash
bunx changeset          # pick the affected packages and a bump
bunx changeset --empty  # for docs, tooling and CI changes
```

Commit the generated file under `.changeset/`. The summary is what lands in the package's
CHANGELOG, which is where consumers read it, so write it for them.

**Never pick `major`.** Every package stays on the `0.x` line, and changesets resolves a `major`
on a `0.x` package to `1.0.0` rather than `0.(x+1).0` — one of them silently takes a package to
1.0. A breaking change gets `minor`, with what breaks stated in the summary.

## Pull requests

Keep the description focused on the code; the template lays out what to cover. Do not include
session links, tracking IDs or platform attributions in commits or pull request text.

Releases are automated: merging to `main` opens a "chore: release" pull request, and merging
that one publishes every package whose version moved.

## Security

Please do not open a public issue for a vulnerability — [`SECURITY.md`](./SECURITY.md) has the
private reporting route.
