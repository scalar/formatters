#!/usr/bin/env bash
# Gate 2 for a possible Kotlin package: is ktfmt's output unchanged when its
# parser is swapped off KotlinCoreEnvironment onto a bare CoreApplicationEnvironment?
#
# This runs entirely on a JVM. No wasm is involved and none is needed: if the
# swap changes a single byte then there is no exactness claim to be had and the
# rest of the idea is dead, so this is the cheapest question to ask first.
#
# It is the same argument the Java package makes for its six google-java-format
# patches, and it is made the same way - stock jar against patched jar over a
# corpus of real source.
set -euo pipefail
cd "$(dirname "$0")"

KTFMT_VERSION="${KTFMT_VERSION:-0.64}"
KOTLIN_VERSION="${KOTLIN_VERSION:-2.3.20}"
COROUTINES_VERSION="${COROUTINES_VERSION:-1.10.2}"
GJF_VERSION="${GJF_VERSION:-1.23.0}"   # the version ktfmt depends on, not ours

WORK="$PWD/work"
mkdir -p "$WORK"
central=https://repo1.maven.org/maven2

fetch() { # fetch <path-under-central> <local-name>
  [ -f "$WORK/$2" ] || curl -fsSL -o "$WORK/$2" "$central/$1"
}

echo "fetching and patching ktfmt"
# The fetch, patch and rebuild live in ktfmt.sh so that compiling ktfmt to wasm
# does not have to run this corpus first. Everything lands in the same ./work.
./ktfmt.sh

fetch "org/jetbrains/kotlin/kotlin-stdlib/$KOTLIN_VERSION/kotlin-stdlib-$KOTLIN_VERSION-sources.jar" stdlib-sources.jar
fetch "org/jetbrains/kotlinx/kotlinx-coroutines-core-jvm/$COROUTINES_VERSION/kotlinx-coroutines-core-jvm-$COROUTINES_VERSION-sources.jar" coroutines-sources.jar

RUNTIME_CP="$WORK/gjf.jar:$WORK/guava.jar:$WORK/kotlin-stdlib.jar:$WORK/kotlin-compiler-embeddable.jar"
RUNTIME_CP="$RUNTIME_CP:$WORK/coroutines.jar:$WORK/annotations.jar:$WORK/kotlin-reflect.jar"
RUNTIME_CP="$RUNTIME_CP:$WORK/kotlin-script-runtime.jar:$WORK/kotlin-daemon-embeddable.jar"


echo "assembling the corpus"
CORPUS="$WORK/corpus"
if [ ! -d "$CORPUS" ]; then
  mkdir -p "$CORPUS/stdlib" "$CORPUS/coroutines" "$CORPUS/ktfmt"
  (cd "$CORPUS/stdlib" && jar xf "$WORK/stdlib-sources.jar")
  (cd "$CORPUS/coroutines" && jar xf "$WORK/coroutines-sources.jar")
  (cd "$CORPUS/ktfmt" && jar xf "$WORK/ktfmt-sources.jar")
fi
echo "corpus: $(find "$CORPUS" -name '*.kt' | wc -l | tr -d ' ') Kotlin files"

javac -nowarn -cp "$WORK/ktfmt.jar:$WORK/gjf.jar" -d "$WORK" FormatAll.java Errors.java

echo
failures=0
for style in meta google kotlinlang; do
  for variant in stock patched; do
    jar="$WORK/ktfmt.jar"
    [ "$variant" = patched ] && jar="$WORK/ktfmt-patched.jar"
    rm -rf "$WORK/out-$variant-$style"
    java -cp "$WORK:$jar:$RUNTIME_CP" FormatAll "$CORPUS" "$WORK/out-$variant-$style" "$style" > /dev/null
  done
  if diff -rq "$WORK/out-stock-$style" "$WORK/out-patched-$style" > "$WORK/diff-$style.txt"; then
    echo "$style: $(find "$WORK/out-stock-$style" -name '*.kt' | wc -l | tr -d ' ')/$(find "$CORPUS" -name '*.kt' | wc -l | tr -d ' ') byte-identical"
  else
    echo "$style: DIVERGED, see $WORK/diff-$style.txt" >&2
    failures=1
  fi
done

# The corpus parses cleanly, so it never exercises a diagnostic. Those are part
# of the contract too: a parser swap that reworded an error is a divergence.
for variant in stock patched; do
  jar="$WORK/ktfmt.jar"
  [ "$variant" = patched ] && jar="$WORK/ktfmt-patched.jar"
  java -cp "$WORK:$jar:$RUNTIME_CP" Errors > "$WORK/errors-$variant.txt"
done
if diff -q "$WORK/errors-stock.txt" "$WORK/errors-patched.txt" > /dev/null; then
  echo "parse-error diagnostics: identical"
else
  echo "parse-error diagnostics: DIVERGED" >&2
  failures=1
fi

exit $failures
