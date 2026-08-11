#!/usr/bin/env bash
# Fetch ktfmt, apply ../patches/ktfmt.patch, and install the result as
# local.ktfmt:ktfmt-patched:<version>.
#
# The patch swaps Parser off KotlinCoreEnvironment - the compiler's CLI
# environment, which resolves extension points reflectively from an XML
# descriptor - onto the bare container the PSI actually needs. gate2.sh is the
# evidence that this changes no output; this script is just the build, factored
# out so that compiling ktfmt to wasm does not require running the 589-file
# corpus first.
#
# Everything lands in ./work, which is gitignored, and is skipped if already
# present.
set -euo pipefail
cd "$(dirname "$0")"

KTFMT_VERSION="${KTFMT_VERSION:-0.64}"
KOTLIN_VERSION="${KOTLIN_VERSION:-2.3.20}"
COROUTINES_VERSION="${COROUTINES_VERSION:-1.10.2}"
GJF_VERSION="${GJF_VERSION:-1.23.0}"   # the version ktfmt depends on, not ours
GUAVA_VERSION="${GUAVA_VERSION:-33.5.0-jre}"

WORK="$PWD/work"
mkdir -p "$WORK"
central=https://repo1.maven.org/maven2

fetch() { # fetch <path-under-central> <local-name>
  [ -f "$WORK/$2" ] || curl -fsSL -o "$WORK/$2" "$central/$1"
}

fetch "com/facebook/ktfmt/$KTFMT_VERSION/ktfmt-$KTFMT_VERSION.jar" ktfmt.jar
fetch "com/facebook/ktfmt/$KTFMT_VERSION/ktfmt-$KTFMT_VERSION-sources.jar" ktfmt-sources.jar
for artifact in kotlin-stdlib kotlin-reflect kotlin-script-runtime kotlin-daemon-embeddable \
    kotlin-compiler-embeddable; do
  fetch "org/jetbrains/kotlin/$artifact/$KOTLIN_VERSION/$artifact-$KOTLIN_VERSION.jar" "$artifact.jar"
done
fetch "org/jetbrains/kotlinx/kotlinx-coroutines-core-jvm/$COROUTINES_VERSION/kotlinx-coroutines-core-jvm-$COROUTINES_VERSION.jar" coroutines.jar
fetch "org/jetbrains/annotations/13.0/annotations-13.0.jar" annotations.jar
fetch "com/google/googlejavaformat/google-java-format/$GJF_VERSION/google-java-format-$GJF_VERSION.jar" gjf.jar
fetch "com/google/guava/guava/$GUAVA_VERSION/guava-$GUAVA_VERSION.jar" guava.jar

# The Kotlin compiler runs out of the embeddable jar, but only with the rest of
# its own runtime beside it - the jar carries no dependencies.
KOTLINC_CP="$WORK/kotlin-compiler-embeddable.jar:$WORK/kotlin-stdlib.jar:$WORK/kotlin-reflect.jar"
KOTLINC_CP="$KOTLINC_CP:$WORK/kotlin-script-runtime.jar:$WORK/kotlin-daemon-embeddable.jar"
KOTLINC_CP="$KOTLINC_CP:$WORK/coroutines.jar:$WORK/annotations.jar"

rm -rf "$WORK/src" "$WORK/classes"
mkdir -p "$WORK/src" "$WORK/classes"
(cd "$WORK/src" && jar xf "$WORK/ktfmt-sources.jar")
patch -s -p1 -d "$WORK/src" < ../patches/ktfmt.patch

java -cp "$KOTLINC_CP" org.jetbrains.kotlin.cli.jvm.K2JVMCompiler -nowarn -no-stdlib \
  -cp "$WORK/ktfmt.jar:$WORK/kotlin-compiler-embeddable.jar:$WORK/kotlin-stdlib.jar:$WORK/gjf.jar:$WORK/guava.jar" \
  -d "$WORK/classes" "$WORK/src/com/facebook/ktfmt/format/Parser.kt"

# Injected into a copy rather than replacing the jar, so every class ktfmt ships
# stays the one Facebook built and only Parser differs.
cp "$WORK/ktfmt.jar" "$WORK/ktfmt-patched.jar"
jar uf "$WORK/ktfmt-patched.jar" -C "$WORK/classes" .

mvn -B -q install:install-file -Dfile="$WORK/ktfmt-patched.jar" \
  -DgroupId=local.ktfmt -DartifactId=ktfmt-patched -Dversion="$KTFMT_VERSION" -Dpackaging=jar
echo "installed local.ktfmt:ktfmt-patched:$KTFMT_VERSION"
