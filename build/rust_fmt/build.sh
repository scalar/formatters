#!/usr/bin/env bash
# Compiles rustfmt to the wasm artifact shipped by @scalar/rust-fmt.
#
# Requires nothing preinstalled but rustup, curl and node: the pinned nightly
# and the wasm target are fetched into rustup, and rust-lang/rust is cloned into
# ./rust, which is gitignored. Consumers of the package need nothing but Node.
# Expect ~20 minutes on a cold run, most of it compiling the compiler crates.
#
# The artifact is committed, so this only needs rerunning when the pins below
# change. Commit the result: the bytes in git are the bytes the tests run
# against.
#
# See SPIKE.md beside this file for why the build is shaped like this - in
# particular why rustfmt is built from inside the rust workspace and why the
# compiler crates are injected through an RUSTC_WRAPPER.
set -euo pipefail
cd "$(dirname "$0")"

# rustfmt's output is welded to the compiler it parses with, so these two pins
# move together and neither moves alone. RUST_COMMIT must be the commit the
# nightly was built from - `rustc +nightly-<date> -vV` prints it - because the
# rustc_private crates are built from that source and loaded by that compiler.
RUST_NIGHTLY="${RUST_NIGHTLY:-nightly-2026-07-19}"
RUST_COMMIT="${RUST_COMMIT:-eff8269f797067c30555e77f160ec84c0ed15cd9}"
RUST_VERSION="${RUST_VERSION:-1.99.0}"

TARGET="wasm32-wasip1"
CHECKOUT="$PWD/rust"
OUT="../../packages/rust/rust_fmt.wasm.br"

if ! command -v rustup > /dev/null; then
  echo "rustup is required: https://rustup.rs" >&2
  exit 1
fi

echo "==> toolchain $RUST_NIGHTLY"
# rustc-dev carries the compiler crates for the *host*, which is what lets the
# pinned nightly build them at all. It is emphatically not the wasm build of
# them - rustup publishes rustc-dev for 34 host targets and no wasm target,
# which is the whole reason this script exists.
rustup toolchain install "$RUST_NIGHTLY" --profile minimal \
  --component rustc-dev,llvm-tools,rust-src --target "$TARGET"

echo "==> rust-lang/rust @ ${RUST_COMMIT:0:9}"
if [ ! -d "$CHECKOUT/.git" ]; then
  mkdir -p "$CHECKOUT"
  git -C "$CHECKOUT" init -q
  git -C "$CHECKOUT" remote add origin https://github.com/rust-lang/rust.git
fi
if [ "$(git -C "$CHECKOUT" rev-parse HEAD 2> /dev/null)" != "$RUST_COMMIT" ]; then
  git -C "$CHECKOUT" fetch --depth 1 origin "$RUST_COMMIT"
  git -C "$CHECKOUT" checkout -q FETCH_HEAD
fi
# Start from a clean tree so a rerun does not stack patches on patched source.
git -C "$CHECKOUT" checkout -q -- src/tools/rustfmt Cargo.toml

echo "==> patching rustfmt"
# rustfmt links rustc_driver for one reason, which its own comment states:
# "Necessary to pull in object code as the rest of the rustc crates are shipped
# only as rmeta files." That is a fact about how rustup distributes rustc-dev,
# not about rustfmt - we compile the crates ourselves and get real rlibs with
# object code in them, so the dependency is dead weight. Its only other use is
# install_ice_hook, a crash reporter that wants a native backtrace.
git -C "$CHECKOUT" apply "$PWD/rustfmt-wasm.patch"

echo "==> installing the reactor crate"
rm -rf "$CHECKOUT/src/tools/rust_fmt"
cp -r crates/rust_fmt "$CHECKOUT/src/tools/rust_fmt"
# It has to be a member of *this* workspace rather than built standalone. Built
# on its own, rustfmt and the compiler crates resolve different versions of
# tracing, annotate_snippets and ignore, and no amount of --extern reconciles
# them; as a member, cargo unifies the graph and the problem does not arise.
python3 - "$CHECKOUT/Cargo.toml" << 'PY'
import sys
path = sys.argv[1]
manifest = open(path).read()
if '"src/tools/rust_fmt"' not in manifest:
    manifest = manifest.replace(
        '  "src/tools/rustfmt",',
        '  "src/tools/rust_fmt",\n  "src/tools/rustfmt",',
        1,
    )
    open(path, "w").write(manifest)
PY

cd "$CHECKOUT"

# Bootstrap normally injects these. Without them rustc_span does not build on
# any target: `error: environment variable not found` for env!("CFG_RELEASE").
export RUSTC_BOOTSTRAP=1
export CFG_RELEASE="$RUST_VERSION-nightly"
export CFG_RELEASE_CHANNEL="nightly"
export CFG_VERSION="$RUST_VERSION-nightly ($(echo "$RUST_COMMIT" | cut -c1-9) $(git show -s --format=%cd --date=short HEAD))"
export CFG_RELEASE_NUM="$RUST_VERSION"
export CFG_COMPILER_HOST_TRIPLE="$(rustc +"$RUST_NIGHTLY" -vV | sed -n 's/^host: //p')"
export CFG_LIBDIR_RELATIVE="lib"

export CARGO_PROFILE_RELEASE_DEBUG=0
export CARGO_PROFILE_RELEASE_STRIP=symbols
export RUSTUP_TOOLCHAIN="$RUST_NIGHTLY"

echo "==> compiler crates -> $TARGET"
# The crates rustfmt loads from the sysroot. Plain cargo cross-compiles them:
# they are ordinary Rust that wanted bootstrap's environment, not bootstrap.
cargo build -p rustc_parse -p rustc_expand -p rustc_ast_pretty \
  --target "$TARGET" --release

echo "==> collecting externs"
WASM_DEPS="$CHECKOUT/target/$TARGET/release/deps"
HOST_DEPS="$CHECKOUT/target/release/deps"
PROC_MACROS="$CHECKOUT/target/proc-macros"

EXTERNS="$(python3 "$OLDPWD/collect-artifacts.py" externs "$WASM_DEPS")"
python3 "$OLDPWD/collect-artifacts.py" procmacros "$HOST_DEPS" "$PROC_MACROS"

echo "==> rust_fmt reactor -> $TARGET"
# The compiler crates go in as --extern, which cargo has no flag for and
# RUSTFLAGS cannot carry (it breaks cargo's --print probe). See
# inject-externs.sh.
#
# stack-size is not a tuning knob. wasm cannot grow its stack the way stacker
# does natively, and rustfmt's parser is deeply recursive: at the default 1MB,
# expressions nested past ~256 levels trap with "memory access out of bounds"
# while native rustfmt handles 1024. At 32MB the wasm build matches native at
# every depth native itself survives. It costs nothing in artifact size - the
# reservation is linear memory, not code.
#
# --cap-lints=allow is required, not cosmetic: arriving via --extern rather than
# the sysroot makes every `extern crate` line in rustfmt fire
# unused_extern_crates, which its own #![deny(rust_2018_idioms)] turns into an
# error. A command-line -A cannot override a crate-level deny.
export RUSTC_WRAPPER="$OLDPWD/inject-externs.sh"
export RUSTFMT_WASM_FLAGS="-L dependency=$WASM_DEPS -L dependency=$PROC_MACROS $EXTERNS --cap-lints=allow -C link-arg=-zstack-size=33554432"

cargo build -p rust_fmt --target "$TARGET" --release

RAW="$CHECKOUT/target/$TARGET/release/rust_fmt.wasm"

echo "==> compressing"
# Ship it brotli-compressed: 6.6MB of wasm packs to ~1.4MB. Quality 11 costs the
# consumer ~40ms of decompression once per process.
#
# No wasm-opt pass, unlike build/swift_fmt/build.sh. Binaryen 123 refuses this
# module outright - "all used types should be allowed" from the validator, and
# it still fails once bulk-memory and the other obvious features are enabled -
# so there is nothing to weigh it against. Cargo already strips symbols and
# debug info here, which is most of what that pass would have been for.
node -e '
  const fs = require("node:fs"), zlib = require("node:zlib")
  const raw = fs.readFileSync(process.argv[1])
  fs.writeFileSync(process.argv[2], zlib.brotliCompressSync(raw, { params: {
    [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
    [zlib.constants.BROTLI_PARAM_LGWIN]: 24,
    [zlib.constants.BROTLI_PARAM_SIZE_HINT]: raw.length,
  }}))
' "$RAW" "$OLDPWD/$OUT"

echo "built $(du -h "$OLDPWD/$OUT" | cut -f1) -> packages/rust/rust_fmt.wasm.br"
