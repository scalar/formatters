#!/usr/bin/env bash
# Install the two build-time artifacts pom.xml and pom-ktfmt.xml depend on:
#
#   local.ktfmt:kotlin-stubs:1   ./stubs and ./resources - classpath replacements
#     that are not `java.*` and so cannot come from TeaVM's class library. They
#     are compiled with --limit-modules java.base because several declare
#     packages the JDK also ships (javax.swing, javax.management, sun.misc);
#     with those modules visible javac refuses to define them, and they have to
#     be defined here since TeaVM has no class library for any of them.
#
#   local.ktfmt:kotlin-policy:1  ./plugin  - a TeaVM build-time extension, which
#     is compiled against TeaVM rather than for it and never becomes wasm. It
#     tells the compiler that one class is findable by name and has one readable
#     field; see plugin/kprobe/KotlinProbeReflectionPolicy.java.
#
# See README.md for what each stub is standing in for.
set -euo pipefail
cd "$(dirname "$0")"

KOTLIN_VERSION="${KOTLIN_VERSION:-2.3.20}"
COROUTINES_VERSION="${COROUTINES_VERSION:-1.10.2}"
TEAVM_VERSION="${TEAVM_VERSION:-0.16.0-forkthree}"

M2="$HOME/.m2/repository"
STDLIB="$M2/org/jetbrains/kotlin/kotlin-stdlib/$KOTLIN_VERSION/kotlin-stdlib-$KOTLIN_VERSION.jar"
COROUTINES="$M2/org/jetbrains/kotlinx/kotlinx-coroutines-core-jvm/$COROUTINES_VERSION/kotlinx-coroutines-core-jvm-$COROUTINES_VERSION.jar"
# Needed by the stubs that replace an IntelliJ class rather than a JDK one: they
# implement interfaces that only exist in the shaded compiler jar.
COMPILER="$M2/org/jetbrains/kotlin/kotlin-compiler-embeddable/$KOTLIN_VERSION/kotlin-compiler-embeddable-$KOTLIN_VERSION.jar"
[ -f "$STDLIB" ] || mvn -B -q dependency:get \
  -Dartifact="org.jetbrains.kotlin:kotlin-stdlib:$KOTLIN_VERSION"
[ -f "$COROUTINES" ] || mvn -B -q dependency:get \
  -Dartifact="org.jetbrains.kotlinx:kotlinx-coroutines-core-jvm:$COROUTINES_VERSION"
[ -f "$COMPILER" ] || mvn -B -q dependency:get \
  -Dartifact="org.jetbrains.kotlin:kotlin-compiler-embeddable:$KOTLIN_VERSION"

rm -rf build/stubs && mkdir -p build/stubs
javac -nowarn --limit-modules java.base -cp "$STDLIB:$COROUTINES:$COMPILER" -d build/stubs \
  $(find stubs -name '*.java')
jar cf build/kotlin-stubs.jar -C build/stubs .
mvn -B -q install:install-file -Dfile=build/kotlin-stubs.jar \
  -DgroupId=local.ktfmt -DartifactId=kotlin-stubs -Dversion=1 -Dpackaging=jar
echo "installed local.ktfmt:kotlin-stubs:1"

# The policy is discovered by ServiceLoader off TeaVM's own classloader. TeaVM
# generates this file from @Autoregistered via an annotation processor; writing
# it by hand keeps the probe from needing the processor on its classpath.
SPI="$HOME/.m2/repository/org/teavm/teavm-extension-spi/$TEAVM_VERSION/teavm-extension-spi-$TEAVM_VERSION.jar"
APIS="$HOME/.m2/repository/org/teavm/teavm-extension-apis/$TEAVM_VERSION/teavm-extension-apis-$TEAVM_VERSION.jar"
if [ ! -f "$SPI" ] || [ ! -f "$APIS" ]; then
  echo "need TeaVM $TEAVM_VERSION in the local Maven repo; see README.md" >&2
  exit 1
fi
rm -rf build/plugin && mkdir -p build/plugin/META-INF/services
javac -nowarn -cp "$SPI:$APIS" -d build/plugin $(find plugin -name '*.java')
echo kprobe.KotlinProbeReflectionPolicy \
  > build/plugin/META-INF/services/org.teavm.extension.spi.reflection.ReflectionPolicy
echo kprobe.KotlinProbeResourcesPolicy \
  > build/plugin/META-INF/services/org.teavm.extension.spi.resources.ResourcesPolicy
jar cf build/kotlin-policy.jar -C build/plugin .
mvn -B -q install:install-file -Dfile=build/kotlin-policy.jar \
  -DgroupId=local.ktfmt -DartifactId=kotlin-policy -Dversion=1 -Dpackaging=jar
echo "installed local.ktfmt:kotlin-policy:1"
