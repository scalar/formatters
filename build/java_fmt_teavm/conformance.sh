#!/usr/bin/env bash
# The evidence behind this package's exactness claim, in two parts.
#
# 1. That the six google-java-format patches are neutral: the corpus is
#    formatted on a plain JVM by the stock jar and by the patched one, and the
#    results are compared. If they ever diverge, the patches are not what they
#    claim to be and nothing downstream is worth checking.
# 2. That the wasm build matches the tool: the same corpus is formatted through
#    the module and compared with what the *stock* CLI wrote, in both styles.
#
# The corpus is Guava 33.5.0's sources plus google-java-format's own - 658 files
# of real, varied Java. Run after build.sh; it reuses that toolchain directory.
#
# Needs a JDK 21 and a Node 24.15+ (see packages/java/README.md for why 24.15).
set -euo pipefail
cd "$(dirname "$0")"

GJF_VERSION="${GJF_VERSION:-1.36.1}"
GUAVA_VERSION="${GUAVA_VERSION:-33.5.0-jre}"

TOOLCHAIN="$PWD/toolchain"
CORPUS="$TOOLCHAIN/corpus"
STOCK_JAR="$TOOLCHAIN/google-java-format-$GJF_VERSION-all-deps.jar"
PATCHED_JAR="$TOOLCHAIN/google-java-format-$GJF_VERSION-patched.jar"

for jar in "$STOCK_JAR" "$PATCHED_JAR"; do
  [ -f "$jar" ] || { echo "missing $jar - run build.sh first" >&2; exit 1; }
done
[ -f target/wasm/classes.wasm ] || { echo "missing target/wasm/classes.wasm - run build.sh first" >&2; exit 1; }

if [ ! -d "$CORPUS" ]; then
  echo "fetching the corpus"
  mkdir -p "$CORPUS/guava" "$CORPUS/gjf"
  guava="$TOOLCHAIN/guava-$GUAVA_VERSION-sources.jar"
  [ -f "$guava" ] || curl -fsSL -o "$guava" \
    "https://repo1.maven.org/maven2/com/google/guava/guava/$GUAVA_VERSION/guava-$GUAVA_VERSION-sources.jar"
  (cd "$CORPUS/guava" && jar xf "$guava")
  (cd "$CORPUS/gjf" && jar xf "$TOOLCHAIN/google-java-format-$GJF_VERSION-sources.jar")
fi
total="$(find "$CORPUS" -name '*.java' | wc -l | tr -d ' ')"
echo "corpus: $total files"

# google-java-format needs javac's internals opened to it, and --replace is what
# makes one JVM enough for the whole corpus: formatting several files to stdout
# concatenates them with no delimiter.
run_gjf() {
  local jar="$1"; shift
  local exports=()
  for pkg in api code file main parser tree util; do
    exports+=("--add-exports=jdk.compiler/com.sun.tools.javac.$pkg=ALL-UNNAMED")
  done
  find "$1" -name '*.java' | sort | xargs java "${exports[@]}" -jar "$jar" --replace "${@:2}"
}

reference() {
  local dir="$1"; shift
  rm -rf "$dir"
  cp -r "$CORPUS" "$dir"
  run_gjf "$STOCK_JAR" "$dir" "$@"
}

echo
echo "1. patched sources against stock, on a JVM"
reference "$TOOLCHAIN/ref-google"
rm -rf "$TOOLCHAIN/patched-google"
cp -r "$CORPUS" "$TOOLCHAIN/patched-google"
run_gjf "$PATCHED_JAR" "$TOOLCHAIN/patched-google"
if diff -rq "$TOOLCHAIN/ref-google" "$TOOLCHAIN/patched-google" > "$TOOLCHAIN/patch-diff.txt"; then
  echo "   $total/$total identical - the patches change no output"
else
  echo "   DIVERGED, see $TOOLCHAIN/patch-diff.txt" >&2
  exit 1
fi

echo
echo "2. the wasm module against stock, in both styles"
node corpus-check.ts target/wasm/classes.wasm "$CORPUS" "$TOOLCHAIN/ref-google" google
reference "$TOOLCHAIN/ref-aosp" --aosp
node corpus-check.ts target/wasm/classes.wasm "$CORPUS" "$TOOLCHAIN/ref-aosp" aosp
