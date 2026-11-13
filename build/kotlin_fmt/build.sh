#!/usr/bin/env bash
# Compiles ktrs's formatter to the wasm artifact @scalar/kotlin-fmt ships - the
# package's one artifact, and the whole of what it runs.
#
# ktrs is ktfmt reimplemented in Rust, Kotlin parser included. It is not ktfmt
# compiled, so the package's claim to ktfmt's output rests on
# packages/kotlin/test/ktfmt-conformance.test.ts, which runs the real ktfmt jar.
#
# Requires rustup, git and node. The repo's Rust toolchain and the wasm target
# are fetched here; ktrs is cloned into ./ktrs, which is gitignored. Expect ~2
# minutes cold. The artifact is committed, so this only needs rerunning when a
# pin below or entry/ changes. Commit the result: the bytes in git are the bytes
# the tests run against.
set -euo pipefail
cd "$(dirname "$0")"

# ktrs is pinned by commit: the v0.5.3 release, which tracks ktfmt 0.65.
# KTFMT_VERSION is not an input to the build - it names the release ktrs ports,
# which is what the conformance test installs as its oracle. Move the two
# together, from the ktfmt version a ktrs release's README says it tracks, and
# rerun the conformance test over a corpus when you do.
KTRS_COMMIT="${KTRS_COMMIT:-8e88950d33936bdd276a9b53b04c6e9f1615e9b6}"
KTRS_VERSION="${KTRS_VERSION:-0.5.3}"
KTFMT_VERSION="${KTFMT_VERSION:-0.65}"

TARGET="wasm32-unknown-unknown"
CHECKOUT="$PWD/ktrs"
OUT="../../packages/kotlin/kotlin_fmt.wasm.br"

if ! command -v rustup > /dev/null; then
  echo "rustup is required: https://rustup.rs" >&2
  exit 1
fi

# The repo's one Rust toolchain, pinned in rust-toolchain.toml and shared with
# build/rust_fmt and build/rbcop_fmt, so every artifact needs a single install.
RUST_TOOLCHAIN="${RUST_TOOLCHAIN:-$(sed -n 's/^channel = "\(.*\)"$/\1/p' ../../rust-toolchain.toml)}"

echo "==> rust $RUST_TOOLCHAIN, target $TARGET"
rustup toolchain install "$RUST_TOOLCHAIN" --profile minimal --target "$TARGET"
export RUSTUP_TOOLCHAIN="$RUST_TOOLCHAIN"

echo "==> ktrs $KTRS_VERSION @ ${KTRS_COMMIT:0:9} (ktfmt $KTFMT_VERSION)"
if [ ! -d "$CHECKOUT/.git" ]; then
  mkdir -p "$CHECKOUT"
  git -C "$CHECKOUT" init -q
  git -C "$CHECKOUT" remote add origin https://github.com/Hexay/ktrs.git
fi
if [ "$(git -C "$CHECKOUT" rev-parse HEAD 2> /dev/null)" != "$KTRS_COMMIT" ]; then
  git -C "$CHECKOUT" fetch --depth 1 origin "$KTRS_COMMIT"
  git -C "$CHECKOUT" checkout -q FETCH_HEAD
fi

echo "==> cargo build"
cargo build --release --locked --manifest-path entry/Cargo.toml --target "$TARGET"

cp "entry/target/$TARGET/release/kotlin_fmt.wasm" kotlin_fmt.wasm

# Brotli, and the runtime decompresses once per process.
node -e '
  const fs = require("node:fs"), zlib = require("node:zlib")
  const raw = fs.readFileSync("kotlin_fmt.wasm")
  fs.writeFileSync(process.argv[1], zlib.brotliCompressSync(raw, { params: {
    [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
    [zlib.constants.BROTLI_PARAM_LGWIN]: 24,
    [zlib.constants.BROTLI_PARAM_SIZE_HINT]: raw.length,
  }}))
' "$OUT"

echo "built $(du -h kotlin_fmt.wasm | cut -f1) wasm, $(du -h "$OUT" | cut -f1) brotli -> packages/kotlin/kotlin_fmt.wasm.br"
