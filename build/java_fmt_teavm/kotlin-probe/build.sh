#!/usr/bin/env bash
# Compiles ktfmt to the wasm artifact shipped by @scalar/kotlin-fmt.
#
# Requires nothing preinstalled but a JDK 21, Maven, git and Node: TeaVM, ktfmt
# and the repo's pinned Node are fetched into ../toolchain, which is gitignored.
# Expect ~15 minutes on a cold run, most of it compiling TeaVM.
#
# The artifact is committed, so this only needs rerunning when a pin below or
# ../patches/ktfmt.patch changes. Commit the result: the bytes in git are the
# bytes the tests run against.
#
# On the directory this lives in: it is called kotlin-probe and sits under
# java_fmt_teavm for historical reasons - it started as a feasibility probe on
# top of the Java build. It no longer depends on anything in that directory
# except ../patches/ktfmt.patch, so moving it is now only a rename.
set -euo pipefail
cd "$(dirname "$0")"

# Upstream TeaVM at a pinned commit, plus the patches and shims in ../../teavm.
# See ../../teavm/README.md for what they are and which are upstreamable.
TEAVM_VERSION="${TEAVM_VERSION:-$(cat ../../teavm/TEAVM_VERSION)}"
NODE_VERSION="${NODE_VERSION:-26.7.0}"

TOOLCHAIN="$PWD/../toolchain"
OUT_DIR="../../../packages/kotlin"
mkdir -p "$TOOLCHAIN"

JAVA_HOME="${JAVA_HOME:-$(dirname "$(dirname "$(readlink -f "$(command -v java)")")")}"
export JAVA_HOME
# Grep for the banner line rather than taking the first: a JAVA_TOOL_OPTIONS in
# the environment prints ahead of it.
java_version="$("$JAVA_HOME/bin/java" -version 2>&1 | grep -m1 ' version "' | sed 's/.*version "\([0-9]*\).*/\1/')"
if [ "$java_version" != "21" ]; then
  echo "need JDK 21 (found ${java_version:-unknown} at $JAVA_HOME); set JAVA_HOME" >&2
  exit 1
fi

# ----------------------------------------------------------------------------
# 1. Node, to run the module.
#
# WasmGC with the js-string builtins needs 24.15 at the least, which is the
# floor the published package enforces - see packages/kotlin/src/boot-module.ts.
# What is pinned here is the repo's toolchain version, which sits above that
# floor; the floor itself is what CI's Node smoke test runs against, not this.
# ----------------------------------------------------------------------------
NODE="$TOOLCHAIN/node-v$NODE_VERSION-linux-x64/bin/node"
if [ ! -x "$NODE" ]; then
  echo "fetching Node $NODE_VERSION"
  curl -fsSL -o "$TOOLCHAIN/node.tar.xz" \
    "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-linux-x64.tar.xz"
  tar xf "$TOOLCHAIN/node.tar.xz" -C "$TOOLCHAIN"
  rm -f "$TOOLCHAIN/node.tar.xz"
fi

# ----------------------------------------------------------------------------
# 2. TeaVM: upstream konsoletyper/teavm, patched, plus the java.* shims.
#
# The same TeaVM the Java package builds with. apply.sh skips the build when
# neither the pin nor the patches nor the shims have changed.
# ----------------------------------------------------------------------------
TEAVM_VERSION="$TEAVM_VERSION" ../../teavm/apply.sh

# ----------------------------------------------------------------------------
# 3. The classpath stubs, the build-time policies, and ktfmt itself.
# ----------------------------------------------------------------------------
TEAVM_VERSION="$TEAVM_VERSION" ./stubs.sh
./ktfmt.sh

# ----------------------------------------------------------------------------
# 4. ktfmt to wasm, then compressed into the package.
#
# Brotli because 3.8MB of WasmGC packs to under 1MB, and node:zlib decompresses
# it once per process - so the saving costs an install nothing and adds no
# dependency.
# ----------------------------------------------------------------------------
rm -rf target-ktfmt
mvn -B -q -f pom-ktfmt.xml -Dteavm.version="$TEAVM_VERSION" package

mkdir -p "$OUT_DIR"
cp target-ktfmt/wasm/classes.wasm-runtime.js "$OUT_DIR/kotlin_fmt.runtime.mjs"

# wasm-opt, over TeaVM's output. See ../binaryen.sh for why this was skipped
# until now: the module Binaryen emits was always spec-valid and V8 has stopped
# rejecting it. Worth about 10% off the shipped artifact here, and
# ./conformance.sh is what proves it changes no formatting.
TOOLCHAIN="$TOOLCHAIN" ../binaryen.sh target-ktfmt/wasm/classes.wasm

"$NODE" -e "
const fs = require('node:fs'), zlib = require('node:zlib')
const raw = fs.readFileSync('target-ktfmt/wasm/classes.wasm')
const packed = zlib.brotliCompressSync(raw, {
  params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: raw.length },
})
fs.writeFileSync('$OUT_DIR/kotlin_fmt.wasm.br', packed)
console.log((raw.length / 1048576).toFixed(2) + ' MB raw -> ' + (packed.length / 1048576).toFixed(2) + ' MB brotli')
"

echo "wrote $OUT_DIR/kotlin_fmt.wasm.br and kotlin_fmt.runtime.mjs"
