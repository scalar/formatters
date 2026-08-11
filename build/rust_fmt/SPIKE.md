# Rust: spike results

**Question:** can the real rustfmt be compiled to wasm and run under plain Node,
exactly enough to claim the reference tool rather than a reimplementation?

**Answer: yes.** rustfmt built for `wasm32-wasip1` produced **byte-identical
output to native rustfmt on all 345 files of rustfmt's own test corpus**, with
matching exit codes. It needs no fork of `rust-lang/rust`, no `x.py`, and three
lines of `#[cfg]` on rustfmt itself.

This document records the verified recipe, and why the build beside it is shaped
the way it is. `packages/rust` was built on the back of it — see "What was built
on it" at the bottom.

## Correcting the record

`packages/rust` was removed in 5cd4a9e because it wrapped `prettyplease` rather
than rustfmt. That reasoning still holds and nothing here disputes it — a
`prettyplease` package drops non-doc comments and cannot survive
`cargo fmt --check`, and it should not come back.

But `.changeset/drop-rust-package.md` also states that rustfmt "cannot compile
to wasm at all." That part is wrong, and this spike is the counter-evidence. The
premise behind it is correct — `rustc-dev` genuinely is not distributed for
`wasm32-*` — but the conclusion does not follow, because the compiler crates can
be built from source for wasm instead of downloaded.

## Why this looked impossible

rustfmt is not a normal crate. `src/lib.rs` opens with
`#![feature(rustc_private)]` and pulls eight compiler crates from the sysroot:

```rust
extern crate rustc_ast;         extern crate rustc_expand;
extern crate rustc_ast_pretty;  extern crate rustc_parse;
extern crate rustc_data_structures; extern crate rustc_session;
extern crate rustc_errors;      extern crate rustc_span;
```

Those ship in rustup's `rustc-dev` component, which is published for **34 host
targets and no wasm target** (checked against `channel-rust-nightly.toml`;
`rust-std` does ship `wasm32-wasip1`). The `rustc-ap-*` crates that once
mirrored the parser to crates.io stopped at `727.0.0` on 2021-07-06.

So `cargo build --target wasm32-wasip1` on rustfmt fails with eight
`E0463: can't find crate` errors, and rustup cannot fix it.

## What actually works

The compiler crates are ordinary Rust. They do not need bootstrap — they need
bootstrap's *environment variables*. Set those and plain cargo cross-compiles
them to wasm with **zero errors**, codegen included. `stacker`, `psm`, `blake3`,
`parking_lot` and `rustc_thread_pool` all build for wasm as-is.

### 1. Pin the toolchain

rustfmt's `rust-toolchain` names the nightly its parser must match. At the time
of the spike:

```
channel = "nightly-2026-07-19"     # rustc 1.99.0-nightly (eff8269f7 2026-07-18)
```

```bash
rustup toolchain install nightly-2026-07-19 --profile minimal \
  --component rustc-dev,llvm-tools,rust-src --target wasm32-wasip1
```

Check out `rust-lang/rust` at that exact commit — rustfmt is a subtree at
`src/tools/rustfmt` and a member of the root workspace, which matters below.

### 2. The bootstrap environment

Without these, `rustc_span` fails to build on *any* target with
`error: environment variable not found ... env!("CFG_RELEASE")`.

```bash
export RUSTC_BOOTSTRAP=1
export CFG_RELEASE="1.99.0-nightly"
export CFG_RELEASE_CHANNEL="nightly"
export CFG_VERSION="1.99.0-nightly (eff8269f7 2026-07-18)"
export CFG_RELEASE_NUM="1.99.0"
export CFG_COMPILER_HOST_TRIPLE="x86_64-unknown-linux-gnu"
export CFG_LIBDIR_RELATIVE="lib"
```

### 3. Build the compiler crates for wasm

```bash
cargo build -p rustc_parse -p rustc_expand -p rustc_ast_pretty \
  --target wasm32-wasip1 --release
```

### 4. Patch rustfmt — three lines

Both hunks remove `rustc_driver`, which rustfmt only links because of how
`rustc-dev` is distributed. Its own comment says so: *"Necessary to pull in
object code as the rest of the rustc crates are shipped only as rmeta files."*
We build real rlibs with object code in them, so it is dead weight. The only
other use is `install_ice_hook`, a crash-reporter nicety.

```diff
--- a/src/tools/rustfmt/src/lib.rs
+++ b/src/tools/rustfmt/src/lib.rs
   #[allow(unused_extern_crates)]
+ #[cfg(not(target_family = "wasm"))]
   extern crate rustc_driver;

--- a/src/tools/rustfmt/src/bin/main.rs
+++ b/src/tools/rustfmt/src/bin/main.rs
+ #[cfg(not(target_family = "wasm"))]
  extern crate rustc_driver;

  fn main() {
+     #[cfg(not(target_family = "wasm"))]
      rustc_driver::install_ice_hook(BUG_REPORT_URL, |_| ());
```

### 5. Build rustfmt *inside* the rust workspace

This is the step that took the longest to find. Building from a standalone
rustfmt checkout fails: rustfmt and the compiler crates pull different versions
of `tracing`, `annotate_snippets` and `ignore`, and injected `--extern` flags
cannot reconcile them. Built as a workspace member, cargo unifies the graph and
the problem disappears.

The compiler crates still have to be injected as `--extern`, which cargo has no
flag for. `RUSTFLAGS` does not work — cargo probes rustc with `--print` and
`--extern` breaks the probe (`error: output of --print=file-names missing`).
An `RUSTC_WRAPPER` that skips probes and host builds does work; see
`inject-externs.sh` beside this file.

```bash
export RUSTC_WRAPPER=.../inject-externs.sh
export RUSTFMT_WASM_FLAGS="-L dependency=<target>/wasm32-wasip1/release/deps \
  -L dependency=<procmacros> $(cat externs.txt) --cap-lints=allow \
  -C link-arg=-zstack-size=33554432"
cargo build -p rustfmt-nightly --bin rustfmt --target wasm32-wasip1 --release
```

Notes on the flags:

- **proc macros are host artifacts.** `rustc_macros`, `derive_where` and 15
  others are `.so` files under `target/release/deps`. They must be on a `-L`
  path, but copied to a directory of their *own* — pointing `-L` at the whole
  host deps directory shadows the wasm builds of `tracing`, `ignore` and
  `annotate_snippets` and breaks the build.
- **`--cap-lints=allow`** is required. Arriving via `--extern` rather than the
  sysroot makes every `extern crate` line fire `unused_extern_crates`, which
  rustfmt's `#![deny(rust_2018_idioms)]` turns into an error. A command-line
  `-A` does not override a crate-level `deny`.
- **`-zstack-size`** — see the stack section below.

## Results

Measured against `rustfmt 1.9.0-nightly (eff8269f79 2026-07-18)`, the official
binary from the same commit, both reading stdin with `--emit stdout`.

| | |
|:---|:---|
| Corpus | `src/tools/rustfmt/tests/source/*.rs` (345 files) |
| Byte-identical stdout | **345 / 345** |
| Exit-code mismatches | **0** (339 clean, 6 rejected by both) |
| Artifact | **7.0 MB raw, 1.44 MB brotli** |
| Runtime | 22 ms compile, 44 ms format (Node 22 `node:wasi`) |
| WASI imports | 21, all `wasi_snapshot_preview1` |

Size lands **below every existing package** in this repo — ruby 3.9M, java 4.4M,
swift 13M.

The import list contains no `thread_spawn` and no shared memory, so
`@bjorn3/browser_wasi_shim` — already a dependency of `@scalar/swift-fmt` — can
host it unchanged, and none of the COOP/COEP constraints that browser-hosted
rustc projects carry apply here.

## The stack limit

wasm cannot grow its stack the way `stacker` does natively, and rustfmt's parser
is deeply recursive. At the default 1 MB stack, deeply nested expressions die
with `memory access out of bounds`:

| nesting depth | native | wasm @ 1 MB | wasm @ 32 MB |
|---:|:---|:---|:---|
| 16 – 128 | ok | ok | ok |
| 256 – 1024 | ok | **overflow** | ok |
| 2048 | `SIGABRT` | overflow | exits 1 |

`-C link-arg=-zstack-size=33554432` closes the gap completely. At 32 MB the wasm
build matches native at every depth native itself survives, and fails more
gracefully than native at the depth where native aborts. Costs nothing in
artifact size (linear-memory reservation, not code).

## What was built on it

All three, in this PR:

1. `build.sh` beside this file, in the shape of `build/swift_fmt/build.sh` -
   pinned, and committing the artifact.
2. `packages/rust/` - the TypeScript wrapper. The module is a WASI reactor with
   a `run` export rather than the CLI this spike drove through stdin, because
   the whole corpus runs through one instance in 530ms where re-instantiating
   per file costs more than the formatting.
3. `packages/rust/test/native-conformance.test.ts` - asserting, since the
   package is exact, and skipping unless the native `rustfmt` on hand is the
   exact pinned build.

One thing this spike did not anticipate: rustfmt's `load_config` is unusable
here. Every path through it reaches `fs::canonicalize`, which Rust's standard
library does not implement on `wasm32-wasip1`, so configuration goes through
`Config::override_value` instead - the `rustfmt --config key=value` path.

**The standing cost is unchanged.** rustfmt's output is welded to a specific
nightly, and the sysroot has to be rebuilt against that nightly on every rustfmt
bump. That is a recurring obligation, and it is the reason `RUST_NIGHTLY` and
`RUST_COMMIT` in `build.sh` are pinned together and the conformance test refuses
to compare against anything else.
