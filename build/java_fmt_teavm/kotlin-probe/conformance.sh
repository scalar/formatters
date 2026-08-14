#!/usr/bin/env bash
# Gate 3: is the wasm module's output the same as ktfmt's own, byte for byte?
#
# gate2.sh asked whether the parser swap changes ktfmt's output, on a JVM, and
# answered no. This asks the other half: whether compiling that same patched
# ktfmt to wasm changes it. Same corpus, same three styles, same encoding on both
# sides - "O" and the formatted source, or "E" and the exception - so a
# divergence in a diagnostic counts as a divergence.
#
# This is the measurement the exactness claim in the root README would rest on.
# It needs ./stubs.sh, ./ktfmt.sh and a built module; run gate2.sh first if the
# corpus is not assembled yet.
set -euo pipefail
cd "$(dirname "$0")"

WASM_DIR="${WASM_DIR:-$PWD/target-ktfmt/wasm}"
WORK="$PWD/work"
CORPUS="${CORPUS:-$WORK/corpus}"
NODE="${NODE:-$PWD/../toolchain/node-v26.7.0-linux-x64/bin/node}"
[ -x "$NODE" ] || NODE=node

if [ ! -d "$CORPUS" ]; then
  echo "no corpus at $CORPUS - run ./gate2.sh first" >&2
  exit 1
fi
if [ ! -f "$WASM_DIR/classes.wasm" ]; then
  echo "no module at $WASM_DIR - run mvn -f pom-ktfmt.xml package" >&2
  exit 1
fi

KOTLIN_VERSION="${KOTLIN_VERSION:-2.3.20}"
RUNTIME_CP="$WORK/gjf.jar:$WORK/guava.jar:$WORK/kotlin-stdlib.jar:$WORK/kotlin-compiler-embeddable.jar"
RUNTIME_CP="$RUNTIME_CP:$WORK/coroutines.jar:$WORK/annotations.jar:$WORK/kotlin-reflect.jar"
RUNTIME_CP="$RUNTIME_CP:$WORK/kotlin-script-runtime.jar:$WORK/kotlin-daemon-embeddable.jar"

javac -nowarn -cp "$WORK/ktfmt-patched.jar:$WORK/gjf.jar" -d "$WORK" FormatAll.java Errors.java

total=$(find "$CORPUS" -name '*.kt' | wc -l | tr -d ' ')
echo "corpus: $total Kotlin files"
echo

failures=0
for style in meta google kotlinlang; do
  rm -rf "$WORK/conf-jvm-$style" "$WORK/conf-wasm-$style"
  java -cp "$WORK:$WORK/ktfmt-patched.jar:$RUNTIME_CP" \
    FormatAll "$CORPUS" "$WORK/conf-jvm-$style" "$style" > /dev/null
  "$NODE" format-all.ts "$WASM_DIR" "$CORPUS" "$WORK/conf-wasm-$style" "$style" > /dev/null

  if diff -rq "$WORK/conf-jvm-$style" "$WORK/conf-wasm-$style" > "$WORK/conf-diff-$style.txt"; then
    echo "$style: $total/$total byte-identical"
  else
    echo "$style: $(grep -c . "$WORK/conf-diff-$style.txt") differ, see $WORK/conf-diff-$style.txt" >&2
    failures=1
  fi
done

exit $failures
