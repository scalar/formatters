# Scalar Rust Formatter

[![Version](https://img.shields.io/npm/v/%40scalar%2Frust-fmt)](https://www.npmjs.com/package/@scalar/rust-fmt)
[![Downloads](https://img.shields.io/npm/dm/%40scalar%2Frust-fmt)](https://www.npmjs.com/package/@scalar/rust-fmt)
[![License](https://img.shields.io/npm/l/%40scalar%2Frust-fmt)](https://www.npmjs.com/package/@scalar/rust-fmt)
[![Discord](https://img.shields.io/discord/1135330207960678410?style=flat&color=5865F2)](https://discord.gg/scalar)

Rust formatter that runs on plain Node. No Rust toolchain, no `cargo` on `PATH`, no rustup, no postinstall download.

---

Scalar is an open-source API platform for teams who want beautiful developer interfaces without vendor lock-in.

- **[API References](https://scalar.com/products/api-references/getting-started)** — Interactive API documentation from OpenAPI and AsyncAPI specs.
- **[Developer Docs](https://scalar.com/products/docs/getting-started)** — Write in Markdown/MDX, generate API references, sync with two-way Git.
- **[SDK Generator](https://scalar.com/products/sdk-generator/getting-started)** — Type-safe SDKs and CLIs in TypeScript, Python, Go, PHP, Java, and Ruby.
- **[API Client](https://scalar.com/products/api-client/getting-started)** — Open-source, offline-first Postman alternative built on OpenAPI.

20M+ monthly npm installs · 15,500+ GitHub stars · MIT licensed · [scalar.com](https://scalar.com)

---

```bash
npm i @scalar/rust-fmt
```

```js
import { format } from '@scalar/rust-fmt'

await format('pub fn add(a: i32,b:i32)->i32{a+b}')
// pub fn add(a: i32, b: i32) -> i32 {
//     a + b
// }
```

Async because the first call decompresses the artifact, compiles it and boots
the module — about 150ms. That work is cached, so every later call is a few
milliseconds.

Options are rustfmt's own configuration keys, in camelCase — `{ maxWidth }`,
`{ tabSpaces }`, `{ hardTabs }`, `{ styleEdition }`, and the rest. Anything you
leave out keeps rustfmt's default, because they are applied through rustfmt's
own `Config::override_value`, the same code path as `rustfmt --config`.

```js
await format(source, { maxWidth: 120, tabSpaces: 2 })
await format(source, { styleEdition: '2024', edition: '2021' })
await format(source, { config: { fn_call_width: '80' } }) // anything not named above
```

## Formatting without awaiting

`formatSync` is for callers with no `await` to give — a code generator that
formats each file inside the synchronous builder that emits it, a template
renderer, a plugin hook that has to return a string.

```js
import { formatSync, init } from '@scalar/rust-fmt'

await init()
const formatted = formatSync(source)
```

Booting is the one thing that cannot be made synchronous, so `init` covers it
once and `formatSync` throws until it has. Everything after that already was
synchronous — `format` was only ever awaiting the boot, and both produce the
same bytes.

Prefer `format` where you can await: it needs no setup call and cannot throw that
error.

## It runs in the browser too

The import does not change — bundlers and browsers pick the `browser` export
condition on their own, and `format` has the same signature and returns the same
bytes. Only the wasm's route in differs: fetched rather than read from disk.

```js
import { format, init } from '@scalar/rust-fmt'

// Optional. The artifact resolves next to the module by default, which Vite,
// Rollup, webpack and a plain CDN handle unaided. esbuild does not rewrite
// `new URL(..., import.meta.url)`, so there it needs naming.
await init({ url: '/assets/rust_fmt.wasm.br' })

await format(source)
```

Run it in a worker. Booting compiles 6.2 MB of wasm, which is a visibly frozen
tab if it happens on the main thread.

The browser reads the same brotli artifact as Node (1.3 MB over the wire) and
expands it with `DecompressionStream('brotli')` where the engine has it, or a
208 KB wasm decoder where it does not — Chrome, today. Serving the artifact with
`Content-Encoding: br`, or serving an uncompressed `.wasm`, skips the decoder
entirely:

```js
await init({ url: '/assets/rust_fmt.wasm', encoding: 'none' })
```

## This is the real rustfmt, and the output is exact

This is **actual [rustfmt](https://github.com/rust-lang/rustfmt)**, the same
build that ships with the pinned nightly, compiled to WebAssembly. It is not a
reimplementation, so it does not drift.

`test/native-conformance.test.ts` asserts byte-identical output against a native
`rustfmt`, across functions, structs, traits, generics, lifetimes, closures,
macros, async, doc comments and unicode, under four configurations — and
compares refusals as well as successes, because agreeing about what is *not*
formattable is part of being the same tool. That test *asserts* rather than
reports: any divergence is a real bug.

Beyond those samples, the build was checked against **rustfmt's own test corpus
— all 345 files in `tests/source`** — formatted by both the wasm build and the
native CLI. All 345 came out byte-identical, with matching exit status on the
six that rustfmt refuses.

The conformance test only runs against the *exact* rustfmt the artifact was
compiled from, read from the pin in
[`build/rust_fmt/build.sh`](../../build/rust_fmt/build.sh). rustfmt's output
changes between versions, so a `rustfmt` from another toolchain is skipped
rather than compared — comparing it would fail for the wrong reason. To run it:

```bash
RUSTFMT=$(rustup which --toolchain nightly-2026-07-19 rustfmt) bun test packages/rust
```

## The one behaviour left out is configuration discovery

The CLI walks up the filesystem looking for a `rustfmt.toml`. There is no
filesystem here to walk, so if your project has one, read it and pass it in:

```js
import { readFileSync } from 'node:fs'
import { parse } from 'smol-toml' // or any TOML parser

await format(source, { config: parse(readFileSync('rustfmt.toml', 'utf8')) })
```

Worth knowing if you compare this package against your project's CLI output and
see a difference: check that both are using the same configuration, and the same
rustfmt version, before concluding anything. A `rustfmt.toml` the CLI silently
picked up is by far the likeliest explanation.

Note also that rustfmt's default `edition` is 2015, in the package exactly as on
the CLI. Modern syntax needs `{ edition: '2021' }` — without it, `async fn` is a
parse error in both.

## How it is built, and why that was the hard part

It ships as a 1.3MB `rust_fmt.wasm.br` — 6.2MB of wasm, brotli-compressed —
built by [`build/rust_fmt/build.sh`](../../build/rust_fmt/build.sh). It is
committed, so a fresh clone needs nothing extra; `bun run rust:build` rebuilds
it. That makes it the *smallest* artifact in this repo, which is not what anyone
expects from a package containing a Rust parser.

rustfmt is not a normal crate. It opens with `#![feature(rustc_private)]` and
links eight compiler crates — `rustc_parse`, `rustc_expand`, `rustc_ast`,
`rustc_span` and friends — from the sysroot. Those ship in rustup's `rustc-dev`
component, which is published for 34 host targets and **no wasm target at all**.
The usual conclusion is that this cannot be done.

It can, because those crates are ordinary Rust that wants bootstrap's
*environment*, not bootstrap. Given `CFG_RELEASE` and five siblings, plain cargo
cross-compiles them to `wasm32-wasip1` with zero errors. rustfmt itself needs
three lines of `#[cfg]`, dropping a `rustc_driver` link that exists only because
`rustc-dev` ships rmeta-only — its own comment says so, and we compile real
rlibs.

[`build/rust_fmt/SPIKE.md`](../../build/rust_fmt/SPIKE.md) is the full account,
including the parts that took longest to find: rustfmt has to be built as a
member of the `rust-lang/rust` workspace or its dependency versions collide, and
the compiler crates have to be injected through an `RUSTC_WRAPPER` because
`RUSTFLAGS` breaks cargo's `--print` probe.

**The wasm stack is the one real limitation, and the build closes it.** wasm
cannot grow its stack the way `stacker` does natively, and rustfmt's parser is
deeply recursive: at the default 1MB, expressions nested past ~256 levels trap
with `memory access out of bounds`, while native rustfmt handles 1024. The build
links with `-z stack-size=33554432`, and at 32MB the wasm build matches native at
every depth native itself survives — beyond that, native aborts and this exits
cleanly. It costs nothing in artifact size; the reservation is linear memory,
not code.

## The module is a reactor, and it does not leak

The artifact is a WASI *reactor*: it is instantiated once and its `run` export
is called per format, rather than being re-instantiated for each one. That
matters more here than elsewhere — the whole 345-file corpus runs through a
single instance in 530ms, where instantiating per file costs more than the
formatting does.

Linear memory plateaus at about 35MB and stays there across the corpus, so there
is nothing to recycle. An instance is only dropped if a format traps, since a
trap leaves the module mid-call with no way to unwind.

It uses [`@bjorn3/browser_wasi_shim`](https://github.com/bjorn3/browser_wasi_shim)
rather than `node:wasi`, for the same reason the Ruby and Swift packages do: it
is pure JavaScript with an in-memory filesystem, so the source being formatted
never touches disk. It also sidesteps a real defect — repeatedly instantiating a
module this size through `node:wasi` segfaults Node outright after about fifteen
instances.

## Community

We are API nerds. You too? Let's chat on Discord: <https://discord.gg/scalar>

## License

MIT for this package. The artifact embeds rustfmt, the rustc crates it parses
with and the Rust standard library, all MIT OR Apache-2.0, plus one MPL-2.0
dependency. See [`licenses/NOTICE.md`](licenses/NOTICE.md).
