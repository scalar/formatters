#!/usr/bin/env bash
# Compiles rbcop's Layout autocorrect pass to the wasm artifact shipped by
# @scalar/ruby-fmt beside the syntax_tree one.
#
# rbcop is RuboCop 1.92.2 reimplemented in Rust on Prism. The package runs
# syntax_tree first, to reprint, and this second, as
# `rubocop --autocorrect --only Layout`. See SPIKE.md beside this file for how
# the build is shaped and what was measured.
#
# Requires rustup, curl, git, node and python3. The wasm target and wasi-sdk are fetched
# here; rbcop is cloned into ./rbcop, which is gitignored. Expect ~3 minutes
# cold. The artifact is committed, so this only needs rerunning when a pin
# below, the patch or entry/ changes. Commit the result: the bytes in git are
# the bytes the tests run against.
set -euo pipefail
cd "$(dirname "$0")"

# rbcop is not on crates.io, so it is pinned by commit. It targets RuboCop
# 1.92.2 byte for byte.
RBCOP_COMMIT="${RBCOP_COMMIT:-90cfdb281402921ffe14bb5fc6041da94f05b143}"
WASI_SDK_VERSION="${WASI_SDK_VERSION:-25}"

TARGET="wasm32-wasip1"
CHECKOUT="$PWD/rbcop"
TOOLCHAIN="$PWD/toolchain"
OUT="../../packages/ruby/rbcop_fmt.wasm.br"
WASI_SDK="$TOOLCHAIN/wasi-sdk-${WASI_SDK_VERSION}.0-x86_64-linux"

if ! command -v rustup > /dev/null; then
  echo "rustup is required: https://rustup.rs" >&2
  exit 1
fi

echo "==> rust target $TARGET"
rustup target add "$TARGET"

echo "==> wasi-sdk $WASI_SDK_VERSION"
# Prism and RBS are C parsers under their Rust crates, so the C side needs a
# wasi sysroot. ruby-prism-sys looks for WASI_SDK_PATH itself.
if [ ! -d "$WASI_SDK" ]; then
  mkdir -p "$TOOLCHAIN"
  curl -fsSL "https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-${WASI_SDK_VERSION}/wasi-sdk-${WASI_SDK_VERSION}.0-x86_64-linux.tar.gz" \
    | tar xz -C "$TOOLCHAIN"
fi

echo "==> rbcop @ ${RBCOP_COMMIT:0:9}"
if [ ! -d "$CHECKOUT/.git" ]; then
  mkdir -p "$CHECKOUT"
  git -C "$CHECKOUT" init -q
  git -C "$CHECKOUT" remote add origin https://github.com/costajohnt/rbcop.git
fi
if [ "$(git -C "$CHECKOUT" rev-parse HEAD 2> /dev/null)" != "$RBCOP_COMMIT" ]; then
  git -C "$CHECKOUT" fetch --depth 1 origin "$RBCOP_COMMIT"
  git -C "$CHECKOUT" checkout -q FETCH_HEAD
fi
# Start from a clean tree so a rerun does not stack the patch on patched source.
git -C "$CHECKOUT" checkout -q -- .

echo "==> patching rbcop"
# Gates rbcop's unix-only file plumbing (descriptor-relative writes, inode
# identity, terminal size, execute bits) behind cfg(unix), and rubydex's 64-bit
# struct-size assertions behind target_pointer_width = "64". None of it is on
# the path a single-file Layout pass takes. See SPIKE.md.
git -C "$CHECKOUT" apply "$PWD/rbcop-wasm.patch"

SYSROOT="$WASI_SDK/share/wasi-sysroot"
export WASI_SDK_PATH="$WASI_SDK"
export CC_wasm32_wasip1="$WASI_SDK/bin/clang"
export AR_wasm32_wasip1="$WASI_SDK/bin/llvm-ar"
# RBS's headers do not mark their API visibility("default"), and clang's wasm32
# target defaults to hidden, so without -fvisibility=default bindgen skips every
# function. Host libclang also misses the wasip1 multiarch include directory.
export BINDGEN_EXTRA_CLANG_ARGS="--sysroot=$SYSROOT -isystem $SYSROOT/include/wasm32-wasip1 -D_WASI_EMULATED_MMAN -fvisibility=default"
export CFLAGS_wasm32_wasip1="--sysroot=$SYSROOT -D_WASI_EMULATED_MMAN"
# ruby-prism-sys puts wasi-sdk's libc on the search path, which does not match
# the crt1 rustc bundles, so link against wasi-sdk's sysroot throughout. The
# reactor crt1 rather than the command one: the module is instantiated once and
# called many times, and `_initialize` runs the C constructors exactly once.
export CARGO_TARGET_WASM32_WASIP1_RUSTFLAGS="-C link-self-contained=no -L $SYSROOT/lib/wasm32-wasip1 -C link-arg=$SYSROOT/lib/wasm32-wasip1/crt1-reactor.o"

echo "==> cargo build"
cargo build --release --locked --manifest-path entry/Cargo.toml --target "$TARGET"

cp "entry/target/$TARGET/release/rbcop_fmt.wasm" rbcop_fmt.wasm

echo "==> license texts"
# Regenerated from the lockfile on every build, so the texts shipped beside the
# artifact are those of exactly what it links. See the script's header.
python3 collect-licenses.py entry rbcop ../../packages/ruby/licenses/rbcop

# Brotli, like the Ruby artifact beside it: 19MB of wasm packs to ~2.5MB, and
# the runtime decompresses once per process.
node -e '
  const fs = require("node:fs"), zlib = require("node:zlib")
  const raw = fs.readFileSync("rbcop_fmt.wasm")
  fs.writeFileSync(process.argv[1], zlib.brotliCompressSync(raw, { params: {
    [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
    [zlib.constants.BROTLI_PARAM_LGWIN]: 24,
    [zlib.constants.BROTLI_PARAM_SIZE_HINT]: raw.length,
  }}))
' "$OUT"

echo "built $(du -h "$OUT" | cut -f1) -> packages/ruby/rbcop_fmt.wasm.br"
