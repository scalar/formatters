#!/usr/bin/env bash
# Compiles swift-format to the wasm artifact shipped by @scalar/swift-fmt.
#
# Requires nothing preinstalled: the Swift toolchain, the Swift SDK for
# WebAssembly and Binaryen are downloaded into ./toolchain, which is gitignored.
# Consumers of the package need nothing but Node. Expect ~20 minutes on a cold
# run, most of it the toolchain download and compiling swift-syntax.
#
# The artifact is committed, so this only needs rerunning when the pins below
# change. Commit the result: the bytes in git are the bytes the tests run
# against.
#
# Linux x86_64/aarch64 only. The Swift SDK for WebAssembly is cross-platform,
# but the *host* toolchain URL below is a Linux tarball; on macOS install a
# matching Swift 6.3.3 toolchain and set SWIFT_BIN to its bin directory.
set -euo pipefail
cd "$(dirname "$0")"

# swift-format's release tags track Swift's own: 603.0.0 is the Swift 6.3 one.
# The toolchain, the Swift SDK and swift-format all have to agree - from Swift
# 6.1 the SDK's version must match the toolchain's exactly.
SWIFT_VERSION="${SWIFT_VERSION:-6.3.3}"
SWIFT_FORMAT_VERSION="${SWIFT_FORMAT_VERSION:-603.0.0}"
BINARYEN_VERSION="${BINARYEN_VERSION:-123}"

TOOLCHAIN="$PWD/toolchain"
OUT="../../packages/swift/swift_fmt.wasm.br"
mkdir -p "$TOOLCHAIN"

if [ "$(uname -s)" != "Linux" ] && [ -z "${SWIFT_BIN:-}" ]; then
  echo "this script downloads a Linux toolchain; on $(uname -s) install Swift $SWIFT_VERSION and set SWIFT_BIN" >&2
  exit 1
fi

case "$(uname -m)" in
  x86_64 | amd64) swift_arch=""; binaryen_arch="x86_64" ;;
  arm64 | aarch64) swift_arch="-aarch64"; binaryen_arch="aarch64" ;;
  *) echo "unsupported arch: $(uname -m)" >&2; exit 1 ;;
esac

SWIFT_HOME="$TOOLCHAIN/swift-$SWIFT_VERSION"
if [ -z "${SWIFT_BIN:-}" ] && [ ! -x "$SWIFT_HOME/usr/bin/swift" ]; then
  echo "fetching Swift $SWIFT_VERSION"
  url="https://download.swift.org/swift-${SWIFT_VERSION}-release/ubuntu2404${swift_arch}/swift-${SWIFT_VERSION}-RELEASE/swift-${SWIFT_VERSION}-RELEASE-ubuntu24.04${swift_arch}.tar.gz"
  rm -rf "$SWIFT_HOME"
  mkdir -p "$SWIFT_HOME"
  curl -fsSL "$url" | tar xz -C "$SWIFT_HOME" --strip-components=1
fi
SWIFT_BIN="${SWIFT_BIN:-$SWIFT_HOME/usr/bin}"
export PATH="$SWIFT_BIN:$PATH"

# The Swift SDK for WebAssembly is an official swift.org artifact - this is not
# the SwiftWasm fork. `swift sdk install` is idempotent-ish but errors if the
# bundle is already there, so only install when it is missing.
SDK_ID="swift-${SWIFT_VERSION}-RELEASE_wasm"
if ! swift sdk list 2>/dev/null | grep -qx "$SDK_ID"; then
  echo "fetching the Swift SDK for WebAssembly $SWIFT_VERSION"
  sdk_url="https://download.swift.org/swift-${SWIFT_VERSION}-release/wasm-sdk/swift-${SWIFT_VERSION}-RELEASE/swift-${SWIFT_VERSION}-RELEASE_wasm.artifactbundle.tar.gz"
  curl -fsSL -o "$TOOLCHAIN/wasm-sdk.artifactbundle.tar.gz" "$sdk_url"
  swift sdk install "$TOOLCHAIN/wasm-sdk.artifactbundle.tar.gz"
fi

BINARYEN_HOME="$TOOLCHAIN/binaryen-version_$BINARYEN_VERSION"
if [ ! -x "$BINARYEN_HOME/bin/wasm-opt" ]; then
  echo "fetching Binaryen $BINARYEN_VERSION"
  url="https://github.com/WebAssembly/binaryen/releases/download/version_${BINARYEN_VERSION}/binaryen-version_${BINARYEN_VERSION}-${binaryen_arch}-linux.tar.gz"
  curl -fsSL "$url" | tar xz -C "$TOOLCHAIN"
fi

# swift-format is cloned rather than vendored: it is a SwiftPM package with its
# own pinned dependencies, and Package.resolved is what makes the build
# reproducible. Package.swift next to this file points at this directory.
if [ ! -d "swift-format/.git" ]; then
  echo "fetching swift-format $SWIFT_FORMAT_VERSION"
  rm -rf swift-format
  git clone --depth 1 --branch "$SWIFT_FORMAT_VERSION" \
    https://github.com/swiftlang/swift-format.git swift-format
else
  git -C swift-format fetch --depth 1 origin "tag" "$SWIFT_FORMAT_VERSION"
  git -C swift-format checkout -q "$SWIFT_FORMAT_VERSION"
fi

# The SDK *id*, not the triple. Both installed SDKs - the normal one and the
# embedded one - declare wasm32-unknown-wasip1, so `--swift-sdk
# wasm32-unknown-wasip1` is ambiguous and resolves to the embedded SDK, which
# fails deep inside swift-syntax with "conformance of 'AnyKeyPath' to
# 'Equatable' is unavailable: unavailable in embedded Swift".
#
# stack-size is not a tuning knob either. The default wasm stack overflows on
# ordinary Swift: swift-syntax's own UnicodeScalarExtensions.swift is 10KB and
# chains ~70 `||` operators into one expression, and walking a tree that deep
# traps with "memory access out of bounds". 16MB clears every file in the
# corpus this was checked against.
#
# -mexec-model=reactor has to reach clang, not wasm-ld - passing it with
# -Xlinker gets "invalid target architecture: exec-model=reactor". It makes the
# module export `_initialize` rather than `_start`, so the host instantiates
# once and calls `run` per format instead of rebuilding the memory image.
swift build \
  --swift-sdk "$SDK_ID" \
  -c release \
  -Xswiftc -Osize \
  -Xswiftc -gnone \
  -Xlinker -z -Xlinker stack-size=16777216 \
  -Xswiftc -Xclang-linker -Xswiftc -mexec-model=reactor \
  -Xlinker --export=run

RAW=".build/wasm32-unknown-wasip1/release/swift_fmt.wasm"

# -Os here is worth ~24MB on top of what -Osize and -gnone already save, mostly
# by stripping the debug sections SwiftPM emits regardless.
"$BINARYEN_HOME/bin/wasm-opt" -Os --strip-debug --strip-producers "$RAW" -o swift_fmt.opt.wasm

# Ship it brotli-compressed: 51MB of wasm packs to ~13MB. Quality 11 takes a few
# minutes here and costs the consumer ~300ms of decompression once per process.
node -e '
  const fs = require("node:fs"), zlib = require("node:zlib")
  const raw = fs.readFileSync("swift_fmt.opt.wasm")
  fs.writeFileSync(process.argv[1], zlib.brotliCompressSync(raw, { params: {
    [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
    [zlib.constants.BROTLI_PARAM_LGWIN]: 24,
    [zlib.constants.BROTLI_PARAM_SIZE_HINT]: raw.length,
  }}))
' "$OUT"

rm -f swift_fmt.opt.wasm

echo "built $(du -h "$OUT" | cut -f1) -> packages/swift/swift_fmt.wasm.br"
