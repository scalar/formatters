#!/usr/bin/env bash
# Downloads the real ktfmt - the release jar, with its dependencies - that
# packages/kotlin/test/ktfmt-conformance.test.ts compares the package against.
#
# This is the oracle, not an input: nothing from it is compiled into the
# artifact. The version is KTFMT_VERSION from build.sh, the release the pinned
# ktrs ports, and the checksum pins those exact bytes. Needs curl; running the
# jar needs a JDK 17 or newer.
set -euo pipefail
cd "$(dirname "$0")"

KTFMT_VERSION="$(sed -n 's/^KTFMT_VERSION="\${KTFMT_VERSION:-\(.*\)}"$/\1/p' build.sh)"
# ktfmt moved from com.facebook to org.jetbrains.kotlinx with 0.65.
KTFMT_SHA256="${KTFMT_SHA256:-aba9753b6ab387926179ab7318ba8e0c33dad483ebc72f633e79522265b15214}"
JAR="work/ktfmt-${KTFMT_VERSION}-with-dependencies.jar"

if [ ! -f "$JAR" ]; then
  mkdir -p work
  curl -fsSL -o "$JAR.part" \
    "https://repo1.maven.org/maven2/org/jetbrains/kotlinx/ktfmt/${KTFMT_VERSION}/ktfmt-${KTFMT_VERSION}-with-dependencies.jar"
  mv "$JAR.part" "$JAR"
fi

if ! echo "$KTFMT_SHA256  $JAR" | sha256sum -c --quiet -; then
  echo "$JAR does not match the pinned checksum; delete it and rerun" >&2
  exit 1
fi

echo "ktfmt $KTFMT_VERSION -> build/kotlin_fmt/$JAR"
