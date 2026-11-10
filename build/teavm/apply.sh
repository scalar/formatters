#!/usr/bin/env bash
# Builds the TeaVM both formatter builds compile with: upstream konsoletyper/teavm
# at the commit in UPSTREAM_REF, with ./patches applied by `git am`, published to
# the local Maven repo as the version in TEAVM_VERSION, followed by ./shims.
#
#   ./apply.sh               fetch, patch, build and install (skipped when nothing changed)
#   ./apply.sh --apply-only  fetch and patch only; for rebasing, see README.md
#   ./apply.sh --force       rebuild even if the stamp says it is up to date
#
# The checkout lives in ./toolchain/teavm, which is gitignored. Override with
# TEAVM_SRC, and the source with UPSTREAM_REPO / UPSTREAM_REF / TEAVM_VERSION.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"

UPSTREAM_REPO="${UPSTREAM_REPO:-https://github.com/konsoletyper/teavm.git}"
UPSTREAM_REF="${UPSTREAM_REF:-$(cat "$HERE/UPSTREAM_REF")}"
TEAVM_VERSION="${TEAVM_VERSION:-$(cat "$HERE/TEAVM_VERSION")}"
SRC="${TEAVM_SRC:-$HERE/toolchain/teavm}"

apply_only=false
force=false
for arg in "$@"; do
  case "$arg" in
    --apply-only) apply_only=true ;;
    --force) force=true ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

# Everything that decides the output: rebuild when any of it changes.
stamp="$( { echo "$UPSTREAM_REF $TEAVM_VERSION"; cat "$HERE"/patches/*.patch;
  find "$HERE/shims" -type f -not -path '*/target/*' | LC_ALL=C sort | xargs cat; } | sha256sum | cut -c1-16)"
STAMP_FILE="$SRC/.built-$stamp"
PLUGIN_JAR="$HOME/.m2/repository/org/teavm/teavm-maven-plugin/$TEAVM_VERSION/teavm-maven-plugin-$TEAVM_VERSION.jar"
if ! $apply_only && ! $force && [ -f "$STAMP_FILE" ] && [ -f "$PLUGIN_JAR" ]; then
  echo "TeaVM $TEAVM_VERSION is up to date ($UPSTREAM_REF + $(ls "$HERE"/patches/*.patch | wc -l) patches)"
  exit 0
fi

if [ ! -d "$SRC/.git" ]; then
  mkdir -p "$(dirname "$SRC")"
  git clone --quiet "$UPSTREAM_REPO" "$SRC"
fi
git -C "$SRC" am --abort >/dev/null 2>&1 || true
git -C "$SRC" fetch --quiet "$UPSTREAM_REPO" "$UPSTREAM_REF"
git -C "$SRC" checkout --quiet --detach FETCH_HEAD
git -C "$SRC" reset --quiet --hard
rm -f "$SRC"/.built-*

# Committer identity is only needed because `git am` makes commits; the patches
# keep their own authors.
git -C "$SRC" -c user.name=teavm-patches -c user.email=teavm-patches@localhost \
  am --quiet --keep-cr "$HERE"/patches/*.patch
echo "applied $(ls "$HERE"/patches/*.patch | wc -l) patches onto $(git -C "$SRC" rev-parse --short FETCH_HEAD)"
$apply_only && exit 0

# A full publish rather than just :classlib, because the classlib POM references
# teavm-extension-spi. Tests are run separately; see README.md.
( cd "$SRC" && ./gradlew --no-daemon -q publishToMavenLocal \
    -Pteavm.project.version="$TEAVM_VERSION" -x test -x checkstyleMain -x checkstyleTest )

mvn -B -q -f "$HERE/shims/pom.xml" install -Dteavm.version="$TEAVM_VERSION"

touch "$STAMP_FILE"
echo "installed TeaVM $TEAVM_VERSION and teavm-shims"
