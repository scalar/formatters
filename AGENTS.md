# AGENTS.md

Guidance for AI coding agents (Cursor, Copilot, Claude Code, …) working **in
this repository**. For Claude Code the same rules live in
[`CLAUDE.md`](./CLAUDE.md); the detailed developer guidelines are in
[`.claude/`](./.claude/) — read the one that matches your task:

- [`.claude/architecture.md`](./.claude/architecture.md) — repo structure and the exactness rule
- [`.claude/typescript.md`](./.claude/typescript.md) — TypeScript style, principles, naming
- [`.claude/bun.md`](./.claude/bun.md) — Bun runtime, APIs, testing
- [`.claude/testing.md`](./.claude/testing.md) — test setup, style, examples
- [`.claude/comments.md`](./.claude/comments.md) — comment and JSDoc guidelines

## What this is

`@scalar/formatters` is a **Bun monorepo** of code formatters — Ruby, Java,
Kotlin, C#, Swift, PHP and Rust — built around one hard constraint: **formatting
must work with nothing installed but Node.**

Every package publishes under the `@scalar` scope (`@scalar/ruby-fmt`,
`@scalar/java-fmt`, …) from `github.com/scalar/formatters`.

Bun is the development toolchain only. A published package may not require Bun
at runtime — `bun run test:node` loads each package under plain Node to keep
that promise enforced rather than assumed.

## Workflow

```bash
bun install                 # install workspace deps
bun run build               # compile each package's src/ TypeScript to dist/
bun run types:check         # tsc --noEmit over sources and tests
bun run test                # run every package's tests
bun run test:node           # build, then smoke-test the packages under plain Node
bun run check               # biome lint + format check
bun run format              # biome, write mode (also runs on commit via lefthook)
```

CI runs `build`, `check`, `types:check`, `test` and `test:node` on every pull
request (`.github/workflows/ci.yml`), plus `changeset status` — so a PR without
a changeset fails before review.

Packages are TypeScript. Sources live in `packages/*/src` (one function per
file, arrow functions, `type` over `interface`) and compile to `packages/*/dist`,
which is what consumers import and what `test:node` loads. `dist` is gitignored,
so build before you pack.

## House rules

- **Exactness is a claim about a named reference tool.** "Exact" means the
  package *is* that tool compiled to wasm. A reimplementation is never exact,
  however close it looks — say what diverges instead of rounding up.
- **Add a changeset with every PR.** Run `bunx changeset`, pick the affected
  packages and a semver bump, commit the file under `.changeset/`. For
  docs/tooling changes that touch no published package, use
  `bunx changeset --empty`.
- **Never** put Claude/session links, tracking IDs, or platform attributions in
  commits or PR text — keep them focused on the code.
- Match the surrounding code's style, comment density, and naming. Biome
  (`biome.json`) is the formatter and linter; run `bun run check` before you're
  done.
- Vendored third-party sources (`packages/*/vendor/`) are copied verbatim and
  pinned in a `VERSIONS.json`. Never hand-edit them.
