#!/usr/bin/env bash
# Runs wasm-opt over a TeaVM WasmGC module, in place of nothing.
#
# Shared by both builds - build.sh for google-java-format, kotlin-probe/build.sh
# for ktfmt - because they emit the same shape of module from the same compiler
# and so want the same pass. Binaryen is fetched into ../toolchain alongside
# TeaVM and the JDK, so nothing has to be installed first.
#
# This used to be skipped. The comment that replaced it said Binaryen rewrote
# TeaVM's exception handling into a form V8 rejected - "type error in branch[0]
# (expected (ref exn), got exnref)" - at every optimisation level, and that was
# true when it was written. It was never Binaryen's bug: the reference
# interpreter sends a *non-nullable* `(ref exn)` to a `catch_ref` label
# (`RefT (NoNull, ExnHT)` in `valid.ml`), which is exactly what Binaryen's
# `populateTryTableSentTypes` models, and V8 was the side typing it as a
# nullable `exnref`. V8 has since been fixed, so the pass is simply available
# now. It stays pinned rather than floating because a compiler in the build is a
# pin like any other.
#
# Optimises in place, deliberately. Every other consumer of the build tree -
# conformance.sh, kotlin-probe/format-all.ts, kotlin-probe/run.ts - resolves
# `classes.wasm` by name, so writing beside it would leave all of them checking
# bytes the package no longer ships. There is one module in the tree and it is
# the shipped one.
#
# Usage: binaryen.sh <module.wasm>
set -euo pipefail

BINARYEN_VERSION="${BINARYEN_VERSION:-126}"
TOOLCHAIN="${TOOLCHAIN:-$(cd "$(dirname "$0")" && pwd)/toolchain}"

module="$1"
# wasm-opt reads lazily, so it cannot write over its own input; stage and move.
staged="$module.opt"

release="binaryen-version_$BINARYEN_VERSION"
home="$TOOLCHAIN/$release"
wasm_opt="$home/bin/wasm-opt"

if [ ! -x "$wasm_opt" ]; then
  echo "fetching Binaryen $BINARYEN_VERSION"
  mkdir -p "$TOOLCHAIN"
  curl -fsSL -o "$TOOLCHAIN/$release.tar.gz" \
    "https://github.com/WebAssembly/binaryen/releases/download/version_$BINARYEN_VERSION/$release-x86_64-linux.tar.gz"
  tar xzf "$TOOLCHAIN/$release.tar.gz" -C "$TOOLCHAIN"
  rm -f "$TOOLCHAIN/$release.tar.gz"
fi

# Spelled out rather than --all-features: these are the proposals TeaVM's WasmGC
# backend actually emits, and naming them means a future TeaVM that starts
# emitting something else fails here loudly instead of being optimised under a
# feature set nobody chose.
"$wasm_opt" -O3 \
  --enable-gc \
  --enable-reference-types \
  --enable-exception-handling \
  --enable-strings \
  --enable-bulk-memory \
  --enable-nontrapping-float-to-int \
  --enable-sign-ext \
  --enable-tail-call \
  "$module" -o "$staged"

before=$(wc -c <"$module")
after=$(wc -c <"$staged")
mv "$staged" "$module"
echo "wasm-opt: $((before / 1024)) KB -> $((after / 1024)) KB raw"
