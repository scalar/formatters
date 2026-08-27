#!/usr/bin/env bash
# Compiles google-java-format to the wasm artifact shipped by @scalar/java-fmt,
# using TeaVM rather than Oracle GraalVM Web Image.
#
# Why this exists: the Web Image build (build/java_fmt/build.sh) is exact and
# stays for internal use, but its artifact embeds Oracle code under the GFTC,
# which permits redistribution only where no fee is charged for the artifact or
# for anything bundling it. TeaVM is Apache-2.0 with its own class library, so
# the only non-permissive code left in the output is javac's parser, which is
# GPLv2 *with Classpath Exception* and explicitly permits linking into a product
# distributed under terms of your choice.
#
# Requires nothing preinstalled but a JDK 21, Maven, git and Node: the TeaVM
# source, google-java-format and Binaryen are fetched into ./toolchain, which is
# gitignored. Expect ~10 minutes on a cold run, most of it compiling TeaVM.
#
# The artifact is committed, so this only needs rerunning when a pin below or a
# patch under ./patches changes. Commit the result: the bytes in git are the
# bytes the tests run against.
set -euo pipefail
cd "$(dirname "$0")"

GJF_VERSION="${GJF_VERSION:-1.36.1}"

# The same TeaVM the Kotlin package uses: the fork's master, pinned to a commit.
# It carries every change this build needs as separate commits - see
# patches/README.md - so there is nothing to patch here.
TEAVM_REPO="${TEAVM_REPO:-https://github.com/amritk/teavm.git}"
TEAVM_COMMIT="${TEAVM_COMMIT:-a726013}"
TEAVM_VERSION="${TEAVM_VERSION:-0.16.0-forkthree}"

TOOLCHAIN="$PWD/toolchain"
OUT_DIR="../../packages/java"
mkdir -p "$TOOLCHAIN"

# JDK 21 exactly: google-java-format 1.36.1 parses with javac's own internals,
# and this build replaces its cross-version reflective probes with the calls
# that resolve on 21 (see patches/google-java-format.patch).
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
# 1. TeaVM, from the fork.
#
# This used to clone konsoletyper/teavm at 0.14.1 and apply patches/teavm.patch.
# It now builds the same TeaVM the Kotlin package does, so there is one toolchain
# rather than two and one place to change TeaVM.
#
# A full publish is required rather than just :classlib, because the classlib
# POM references teavm-extension-spi.
# ----------------------------------------------------------------------------
STAMP="$TOOLCHAIN/teavm/.built-$TEAVM_COMMIT"
if [ ! -f "$HOME/.m2/repository/org/teavm/teavm-maven-plugin/$TEAVM_VERSION/teavm-maven-plugin-$TEAVM_VERSION.jar" ] \
  || [ ! -f "$STAMP" ]; then
  echo "building TeaVM $TEAVM_VERSION from source"
  rm -rf "$TOOLCHAIN/teavm"
  git clone --quiet "$TEAVM_REPO" "$TOOLCHAIN/teavm"
  git -C "$TOOLCHAIN/teavm" checkout --quiet "$TEAVM_COMMIT"
  (cd "$TOOLCHAIN/teavm" && ./gradlew --no-daemon -q publishToMavenLocal \
    -Pteavm.project.version="$TEAVM_VERSION" -x test -x checkstyleMain -x checkstyleTest)
  touch "$STAMP"
fi

# ----------------------------------------------------------------------------
# 2. javac, as a jar TeaVM can read.
#
# javac lives in JDK modules, which are not on any classpath, so the two modules
# google-java-format reaches into are extracted and repackaged. Their message
# bundles come out as compiled ListResourceBundle classes, which is what the
# service file in ./stubs points TeaVM at.
# ----------------------------------------------------------------------------
if [ ! -f "$TOOLCHAIN/jdk-compiler.jar" ]; then
  echo "extracting javac from the JDK"
  rm -rf "$TOOLCHAIN/jdk-ext"
  jmod extract --dir "$TOOLCHAIN/jdk-ext" "$JAVA_HOME/jmods/java.compiler.jmod"
  jmod extract --dir "$TOOLCHAIN/jdk-ext" "$JAVA_HOME/jmods/jdk.compiler.jmod"
  # Two modules unpacked into one tree leave one module-info behind; TeaVM reads
  # classes, not modules, and has no use for it.
  rm -f "$TOOLCHAIN/jdk-ext/classes/module-info.class"
  jar cf "$TOOLCHAIN/jdk-compiler.jar" -C "$TOOLCHAIN/jdk-ext/classes" .
fi
mvn -q install:install-file -Dfile="$TOOLCHAIN/jdk-compiler.jar" \
  -DgroupId=org.openjdk -DartifactId=jdk-compiler -Dversion=21 -Dpackaging=jar

# ----------------------------------------------------------------------------
# 3. google-java-format, with its reflective JDK probes patched out.
#
# The six sites in patches/google-java-format.patch each probe for a javac API
# whose shape changed across JDK versions. TeaVM cannot serve those probes, and
# each has exactly one answer on the pinned JDK, so each is replaced with that
# call. The patched classes are injected into a copy of the -all-deps jar rather
# than replacing it, so every dependency stays the version Google shipped.
# ----------------------------------------------------------------------------
JAR="$TOOLCHAIN/google-java-format-$GJF_VERSION-all-deps.jar"
SOURCES_JAR="$TOOLCHAIN/google-java-format-$GJF_VERSION-sources.jar"
base="https://repo1.maven.org/maven2/com/google/googlejavaformat/google-java-format/$GJF_VERSION"
[ -f "$JAR" ] || curl -fsSL -o "$JAR" "$base/google-java-format-$GJF_VERSION-all-deps.jar"
[ -f "$SOURCES_JAR" ] || curl -fsSL -o "$SOURCES_JAR" "$base/google-java-format-$GJF_VERSION-sources.jar"

rm -rf "$TOOLCHAIN/gjf-src" "$TOOLCHAIN/gjf-classes"
mkdir -p "$TOOLCHAIN/gjf-src" "$TOOLCHAIN/gjf-classes"
(cd "$TOOLCHAIN/gjf-src" && jar xf "$SOURCES_JAR")
patch -s -p1 -d "$TOOLCHAIN/gjf-src" < patches/google-java-format.patch

# Every javac package google-java-format touches has to be exported to the
# compiler, the same set the Web Image build needs.
JAVAC_EXPORTS=(
  --add-exports=jdk.compiler/com.sun.tools.javac.api=ALL-UNNAMED
  --add-exports=jdk.compiler/com.sun.tools.javac.code=ALL-UNNAMED
  --add-exports=jdk.compiler/com.sun.tools.javac.file=ALL-UNNAMED
  --add-exports=jdk.compiler/com.sun.tools.javac.main=ALL-UNNAMED
  --add-exports=jdk.compiler/com.sun.tools.javac.parser=ALL-UNNAMED
  --add-exports=jdk.compiler/com.sun.tools.javac.tree=ALL-UNNAMED
  --add-exports=jdk.compiler/com.sun.tools.javac.util=ALL-UNNAMED
)
# Sorted so the compiler sees the same order every run. That removes one source
# of variance but does not make the build bit-reproducible - TeaVM itself lays
# the module out slightly differently between runs, by around 0.2% of the
# compressed size. The behaviour does not vary; the corpus check is what
# establishes that, not a checksum.
find "$TOOLCHAIN/gjf-src" -name '*.java' | sort > "$TOOLCHAIN/gjf-sources.txt"
javac -nowarn -encoding UTF-8 "${JAVAC_EXPORTS[@]}" \
  -cp "$JAR" -d "$TOOLCHAIN/gjf-classes" "@$TOOLCHAIN/gjf-sources.txt"

PATCHED_JAR="$TOOLCHAIN/google-java-format-$GJF_VERSION-patched.jar"
cp "$JAR" "$PATCHED_JAR"
jar uf "$PATCHED_JAR" -C "$TOOLCHAIN/gjf-classes" .

# install-file reads the pom out of META-INF/maven when it is not told otherwise,
# which would put a second, unshaded copy of every google-java-format dependency
# on TeaVM's classpath. The all-deps jar already contains them, so it is
# installed with a pom that declares none.
cat > "$TOOLCHAIN/gjf-patched.pom" <<POM
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <groupId>local.javafmt</groupId>
  <artifactId>google-java-format-patched</artifactId>
  <version>$GJF_VERSION</version>
</project>
POM
mvn -q install:install-file -Dfile="$PATCHED_JAR" -DpomFile="$TOOLCHAIN/gjf-patched.pom"

# ----------------------------------------------------------------------------
# 4. Classpath stubs.
#
# Non-java.* packages resolve from the classpath, so javac's references into
# sun.reflect.annotation and jdk.internal.jmod are satisfied by declarations that
# throw - nothing on the formatter's path calls them. java.* does not resolve
# that way, which is why the class-library additions are in TeaVM's patch
# instead. The same jar carries META-INF/services/java.util.ResourceBundle,
# which is how TeaVM learns to bake in javac's message bundles.
# ----------------------------------------------------------------------------
rm -rf "$TOOLCHAIN/stub-classes"
mkdir -p "$TOOLCHAIN/stub-classes/META-INF/services"
find stubs -name '*.java' | sort > "$TOOLCHAIN/stub-sources.txt"
javac -nowarn -encoding UTF-8 --patch-module java.base=stubs \
  -d "$TOOLCHAIN/stub-classes" "@$TOOLCHAIN/stub-sources.txt"
cp stubs/META-INF/services/java.util.ResourceBundle "$TOOLCHAIN/stub-classes/META-INF/services/"
jar cf "$TOOLCHAIN/teavm-stubs.jar" -C "$TOOLCHAIN/stub-classes" .
mvn -q install:install-file -Dfile="$TOOLCHAIN/teavm-stubs.jar" \
  -DgroupId=local.javafmt -DartifactId=teavm-stubs -Dversion=1 -Dpackaging=jar

# ----------------------------------------------------------------------------
# 5. The module.
# ----------------------------------------------------------------------------
mvn -q -B clean package -Dgjf.version="$GJF_VERSION" -Dteavm.version="$TEAVM_VERSION"

# wasm-opt, over TeaVM's ADVANCED output. See binaryen.sh for why this was
# skipped until now and what changed; the short version is that the module
# Binaryen emits was always spec-valid and V8 has stopped rejecting it. Worth
# about 8% off the shipped artifact, and the conformance corpora are what prove
# it changes no formatting.
TOOLCHAIN="$TOOLCHAIN" ./binaryen.sh target/wasm/classes.wasm

# Ship it brotli-compressed: node:zlib decompresses it once per process in
# ~50ms, so this costs the consumer nothing and adds no dependency.
node -e '
  const fs = require("node:fs"), zlib = require("node:zlib")
  const raw = fs.readFileSync("target/wasm/classes.wasm")
  fs.writeFileSync(process.argv[1], zlib.brotliCompressSync(raw, { params: {
    [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
    [zlib.constants.BROTLI_PARAM_LGWIN]: 24,
    [zlib.constants.BROTLI_PARAM_SIZE_HINT]: raw.length,
  }}))
' "$OUT_DIR/java_fmt.wasm.br"

# The runtime is generated, not glue we could write ourselves: it supplies the
# module's imports, so the module cannot run without it. The modular build is
# an ES module that exports `load`, which the package imports directly.
cp target/wasm/classes.wasm-runtime.js "$OUT_DIR/java_fmt.runtime.mjs"

echo "built $(du -h "$OUT_DIR/java_fmt.wasm.br" | cut -f1) -> packages/java/java_fmt.wasm.br"
