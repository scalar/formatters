#!/usr/bin/env bash
# Compiles google-java-format to the wasm artifact shipped by @scalar/java-fmt.
#
# Requires nothing preinstalled: the toolchain (Oracle GraalVM, Binaryen) and the
# google-java-format jar are downloaded into ./toolchain, which is gitignored.
# Consumers of the package need nothing but Node. Expect ~5 minutes on a cold
# run, most of it the GraalVM download and the native-image build.
#
# The artifact is committed, so this only needs rerunning when GJF_VERSION or the
# toolchain pins below change. Commit the result: the bytes in git are the bytes
# the tests run against.
#
# Oracle GraalVM, not Community Edition. Web Image (--tool:svm-wasm) is the piece
# that emits WasmGC, and it ships only in the Oracle distribution.
set -euo pipefail
cd "$(dirname "$0")"

GJF_VERSION="${GJF_VERSION:-1.36.1}"
GRAALVM_VERSION="${GRAALVM_VERSION:-25.0.4}"
BINARYEN_VERSION="${BINARYEN_VERSION:-123}"

TOOLCHAIN="$PWD/toolchain"
OUT_DIR="../../packages/java"
mkdir -p "$TOOLCHAIN"

case "$(uname -s)" in
  Linux) graal_os="linux"; binaryen_os="linux" ;;
  Darwin) graal_os="macos"; binaryen_os="macos" ;;
  *) echo "unsupported OS: $(uname -s)" >&2; exit 1 ;;
esac
case "$(uname -m)" in
  x86_64 | amd64) graal_arch="x64"; binaryen_arch="x86_64" ;;
  arm64 | aarch64)
    graal_arch="aarch64"
    # Binaryen names the same CPU "aarch64" on Linux and "arm64" on macOS.
    [ "$binaryen_os" = "macos" ] && binaryen_arch="arm64" || binaryen_arch="aarch64"
    ;;
  *) echo "unsupported arch: $(uname -m)" >&2; exit 1 ;;
esac

GRAALVM_HOME="$TOOLCHAIN/graalvm-jdk-$GRAALVM_VERSION"
if [ ! -x "$GRAALVM_HOME/bin/native-image" ]; then
  echo "fetching Oracle GraalVM $GRAALVM_VERSION ($graal_os-$graal_arch)"
  url="https://download.oracle.com/graalvm/25/archive/graalvm-jdk-${GRAALVM_VERSION}_${graal_os}-${graal_arch}_bin.tar.gz"
  rm -rf "$GRAALVM_HOME" "$TOOLCHAIN/graalvm-unpack"
  mkdir -p "$TOOLCHAIN/graalvm-unpack"
  curl -fsSL "$url" | tar xz -C "$TOOLCHAIN/graalvm-unpack"
  # The tarball's top directory carries a build number (25.0.4+7.1) that the
  # download URL does not, so it cannot be predicted - move whatever came out.
  mv "$TOOLCHAIN/graalvm-unpack"/*/ "$GRAALVM_HOME"
  rmdir "$TOOLCHAIN/graalvm-unpack"
  # macOS nests the JDK under Contents/Home.
  [ -d "$GRAALVM_HOME/Contents/Home" ] && GRAALVM_HOME="$GRAALVM_HOME/Contents/Home"
fi
[ -d "$GRAALVM_HOME/Contents/Home" ] && GRAALVM_HOME="$GRAALVM_HOME/Contents/Home"

BINARYEN_HOME="$TOOLCHAIN/binaryen-version_$BINARYEN_VERSION"
if [ ! -x "$BINARYEN_HOME/bin/wasm-as" ]; then
  echo "fetching Binaryen $BINARYEN_VERSION ($binaryen_os-$binaryen_arch)"
  url="https://github.com/WebAssembly/binaryen/releases/download/version_${BINARYEN_VERSION}/binaryen-version_${BINARYEN_VERSION}-${binaryen_arch}-${binaryen_os}.tar.gz"
  curl -fsSL "$url" | tar xz -C "$TOOLCHAIN"
fi
# native-image shells out to wasm-as to assemble the module and fails at
# [1/8] Initializing if it is not on PATH.
export PATH="$BINARYEN_HOME/bin:$PATH"

JAR="$TOOLCHAIN/google-java-format-$GJF_VERSION-all-deps.jar"
if [ ! -f "$JAR" ]; then
  echo "fetching google-java-format $GJF_VERSION"
  curl -fsSL -o "$JAR" \
    "https://repo1.maven.org/maven2/com/google/googlejavaformat/google-java-format/$GJF_VERSION/google-java-format-$GJF_VERSION-all-deps.jar"
fi

# google-java-format parses with javac's own parser, which lives in jdk.compiler
# internals that are not exported. Every javac package it touches has to be
# opened to the builder JVM (-J) as well as to the image.
JAVAC_EXPORTS=(
  --add-exports=jdk.compiler/com.sun.tools.javac.api=ALL-UNNAMED
  --add-exports=jdk.compiler/com.sun.tools.javac.code=ALL-UNNAMED
  --add-exports=jdk.compiler/com.sun.tools.javac.file=ALL-UNNAMED
  --add-exports=jdk.compiler/com.sun.tools.javac.main=ALL-UNNAMED
  --add-exports=jdk.compiler/com.sun.tools.javac.parser=ALL-UNNAMED
  --add-exports=jdk.compiler/com.sun.tools.javac.tree=ALL-UNNAMED
  --add-exports=jdk.compiler/com.sun.tools.javac.util=ALL-UNNAMED
)

rm -rf classes
"$GRAALVM_HOME/bin/javac" \
  --add-modules org.graalvm.webimage.api \
  -cp "$JAR" \
  -d classes \
  JavaFmt.java

"$GRAALVM_HOME/bin/native-image" --tool:svm-wasm \
  -cp "classes:$JAR" \
  -o java_fmt \
  --no-fallback \
  -H:+UnlockExperimentalVMOptions \
  -H:IncludeResourceBundles=com.sun.tools.javac.resources.compiler \
  -H:IncludeResourceBundles=com.sun.tools.javac.resources.javac \
  --initialize-at-build-time=com.sun.tools.javac.file.Locations \
  --initialize-at-build-time=com.sun.tools.javac.resources.compiler \
  --initialize-at-build-time=com.sun.tools.javac.resources.javac \
  `# Not an optimisation - the build fails without it. Trees' class initializer` \
  `# looks up a VarHandle through a Class object resolved at run time, so the` \
  `# analysis cannot fold it and reaches the generic VarHandles.makeFieldHandle,` \
  `# which drags in the accessors for every primitive type. Lowering CAS on` \
  `# float and double crashes the WasmGC backend ("unhandled compare ... EQ").` \
  `# Initializing Trees at build time creates the VarHandle in the builder and` \
  `# snapshots it, so none of that code is reachable at run time.` \
  --initialize-at-build-time=com.google.googlejavaformat.java.Trees \
  "${JAVAC_EXPORTS[@]/#/-J}" \
  JavaFmt

# --all-features would enable stringref, which makes wasm-opt emit
# stringview_wtf16 types that V8 rejects at instantiation. The four features
# disabled here are the ones the module does not use and that no engine we
# target accepts unflagged.
wasm-opt -Os \
  --all-features \
  --disable-strings \
  --disable-shared-everything \
  --disable-custom-descriptors \
  --disable-stack-switching \
  --strip-debug \
  --strip-producers \
  java_fmt.js.wasm -o java_fmt.opt.wasm

# Ship it brotli-compressed: 12MB of WasmGC packs to ~4MB, and node:zlib
# decompresses it once per process in ~100ms, so this costs the consumer nothing
# and adds no dependency.
node -e '
  const fs = require("node:fs"), zlib = require("node:zlib")
  const raw = fs.readFileSync("java_fmt.opt.wasm")
  fs.writeFileSync(process.argv[1], zlib.brotliCompressSync(raw, { params: {
    [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
    [zlib.constants.BROTLI_PARAM_LGWIN]: 24,
    [zlib.constants.BROTLI_PARAM_SIZE_HINT]: raw.length,
  }}))
' "$OUT_DIR/java_fmt.wasm.br"

# The JavaScript half of the image is not glue we could write ourselves: it is
# the generated runtime that provides the module's imports. It ships as-is,
# renamed to .cjs: the runtime reads __filename to locate its wasm, and the
# package is type: module, so as a .js file Node would load it as ESM and it
# would fail at boot with "getCurrentFile is not supported".
cp java_fmt.js "$OUT_DIR/java_fmt.cjs"

rm -rf classes java_fmt.js java_fmt.js.wasm java_fmt.js.wat java_fmt.opt.wasm

echo "built $(du -h "$OUT_DIR/java_fmt.wasm.br" | cut -f1) -> packages/java/java_fmt.wasm.br"
