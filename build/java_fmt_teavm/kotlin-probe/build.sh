#!/usr/bin/env bash
# Compiles ktfmt to the wasm artifact shipped by @scalar/kotlin-fmt.
#
# Requires nothing preinstalled but a JDK 21, Maven, git and Node: TeaVM, ktfmt
# and Node 24 are fetched into ../toolchain, which is gitignored. Expect ~15
# minutes on a cold run, most of it compiling TeaVM.
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

# The fork carries every TeaVM change this build needs, as separate commits on
# master - see ../patches/README.md for what they are and which are upstreamable.
# Pinned to a commit rather than a branch so the build is reproducible.
TEAVM_REPO="${TEAVM_REPO:-https://github.com/amritk/teavm.git}"
TEAVM_COMMIT="${TEAVM_COMMIT:-a726013}"
TEAVM_VERSION="${TEAVM_VERSION:-0.16.0-forkthree}"
NODE_VERSION="${NODE_VERSION:-24.19.0}"

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
# 1. Node 24, to run the module.
#
# WasmGC with the js-string builtins needs it, and it is also the floor the
# published package enforces - see packages/kotlin/src/boot-module.ts.
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
# 2. TeaVM, from the fork.
#
# Nothing is patched here any more: the fork's master is the patched TeaVM, one
# commit per change. That is why this step is a clone and a build rather than a
# patch stack, and why a change to TeaVM is made on the fork rather than in a
# file here.
# ----------------------------------------------------------------------------
STAMP="$TOOLCHAIN/teavm-kotlin/.built-$TEAVM_COMMIT"
if [ ! -f "$HOME/.m2/repository/org/teavm/teavm-maven-plugin/$TEAVM_VERSION/teavm-maven-plugin-$TEAVM_VERSION.jar" ] \
  || [ ! -f "$STAMP" ]; then
  echo "building TeaVM $TEAVM_VERSION from source (~10 minutes)"
  rm -rf "$TOOLCHAIN/teavm-kotlin"
  git clone --quiet "$TEAVM_REPO" "$TOOLCHAIN/teavm-kotlin"
  git -C "$TOOLCHAIN/teavm-kotlin" checkout --quiet "$TEAVM_COMMIT"
  ( cd "$TOOLCHAIN/teavm-kotlin" && ./gradlew --no-daemon -q publishToMavenLocal \
      -Pteavm.project.version="$TEAVM_VERSION" -x test -x checkstyleMain -x checkstyleTest )
  touch "$STAMP"
fi

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
