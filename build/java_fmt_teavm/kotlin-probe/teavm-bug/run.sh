#!/usr/bin/env bash
# Build the reproducer against one or more TeaVM versions and report, for each,
# whether a module came out and whether an engine will load it.
#
# Each version gets its own target directory. That is not tidiness: TeaVM leaves
# the previous classes.wasm in place when a build ends "with errors", so sharing
# a directory makes a failed build look like a successful one from the run
# before it. This is exactly how an earlier reading of these results went wrong.
set -euo pipefail
cd "$(dirname "$0")"

NODE="${NODE:-$PWD/../../toolchain/node-v26.7.0-linux-x64/bin/node}"
[ -x "$NODE" ] || NODE=node

# The classpath stubs, as a jar the pom can depend on. --limit-modules java.base
# because two of them declare packages the JDK also ships (javax.swing,
# javax.management); with those modules visible javac refuses to define them,
# and they have to be defined here since TeaVM has no class library for either.
rm -rf build/stubs && mkdir -p build/stubs
M2=~/.m2/repository
STUB_CP="$M2/org/jetbrains/kotlin/kotlin-stdlib/2.3.20/kotlin-stdlib-2.3.20.jar"
STUB_CP="$STUB_CP:$M2/org/jetbrains/kotlinx/kotlinx-coroutines-core-jvm/1.10.2/kotlinx-coroutines-core-jvm-1.10.2.jar"
javac -nowarn --limit-modules java.base -cp "$STUB_CP" -d build/stubs \
  $(find ../stubs -name '*.java')
jar cf build/stubs.jar -C build/stubs .
mvn -B -q install:install-file -Dfile=build/stubs.jar \
  -DgroupId=local.repro -DartifactId=stubs -Dversion=1 -Dpackaging=jar

for version in "$@"; do
  echo "=== teavm $version ==="
  out="target-$version"
  rm -rf "$out"
  mvn -B -Dteavm.version="$version" -DbuildDirectory="$PWD/$out" package \
    > "$out.log" 2>&1 || true
  grep -E "Output file (successfully built|built with errors)|Classes compiled" "$out.log" || true
  echo "missing-member errors: $(grep -cE '^\[ERROR\] (Class|Method|Field) ' "$out.log" || true)"
  echo "unreached-interface reports: $(grep -c 'unreached interface' "$out.log" || true)"

  wasm="$out/wasm/classes.wasm"
  if [ ! -f "$wasm" ]; then
    echo "RESULT: no module emitted — cannot test this version"
  else
    echo "module: $(stat -c%s "$wasm") bytes"
    "$NODE" check.ts "$wasm"
  fi
  echo
done
