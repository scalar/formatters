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

Six of them (everything but PHP) also run in a browser, behind a `browser`
export condition. That is an addition to the Node constraint, never a relaxation
of it: the Node entry stays the default and stays free of anything a browser
needs.

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
bun run test:browser        # build, then load the browser entries in real Chromium
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

### The public API, and the two entry points behind it

Every package exports the same three things, from both builds:

| | |
|:---|:---|
| `format(source, options?)` | async; boots on demand. The one to reach for. |
| `formatSync(source, options?)` | synchronous; needs `await init()` first, and throws until it has. |
| `init(options?)` | boots the module. Takes `{ url, bytes, encoding }` in the browser build only. |

Booting is the only asynchronous step there has ever been — fetching or reading
the wasm, and compiling it — so `formatSync` runs the same code `format` runs
after its await.

`src/index.ts` is the Node entry and may touch `node:` built-ins; `src/index.browser.ts`
is the browser entry and may not. Both wire the same `createFormat` factory to a
different artifact source (`compile-artifact.ts` reads from disk,
`fetch-artifact.ts` fetches). If you add a package, follow that split — a
`node:` import reachable from the browser entry is the failure this structure
exists to prevent, and `test:browser` is what catches it.

## House rules

- **A browser claim is tested, not asserted.** A package only gets a `browser`
  export condition once `bun run test:browser` loads its built entry in real
  Chromium and asserts byte-identical output to the Node build. Same standard as
  exactness: do not upgrade the README's Browser column without the gate.
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
