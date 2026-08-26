#!/usr/bin/env bash
# Fills bench/corpus/<package> with real sources to benchmark against.
#
# Real files rather than snippets, and the same upstream projects the conformance
# tests use, so that a throughput number here is comparable to a correctness run
# there. Formatter cost is superlinear in nesting depth and expression width, so
# a corpus of hand-written examples reports a speed no consumer will ever see.
#
# The corpus is gitignored: it is tens of megabytes of other people's source and
# it is reproducible from this script. Every checkout is a shallow clone of a
# pinned tag, so a rerun on another machine gets the same bytes and none of the
# history.
#
# Usage: scripts/bench/fetch-corpus.sh [package...]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CORPUS="$ROOT/bench/corpus"
CACHE="$ROOT/bench/.cache"
mkdir -p "$CORPUS" "$CACHE"

# How many files each language's corpus is capped at. A benchmark wants enough
# files to average over and few enough to run in under a minute, and the slower
# packages are two orders of magnitude off the faster ones - so the cap is per
# language rather than shared.
declare -A FILE_CAP=([ruby]=200 [java]=200 [kotlin]=200 [csharp]=200)

# Clones a pinned tag once into the cache, shallow and quiet.
fetch() {
  local key="$1" url="$2" tag="$3"
  if [ -d "$CACHE/$key" ]; then return 0; fi
  echo "fetching $key@$tag"
  git clone --quiet --depth 1 --branch "$tag" "$url" "$CACHE/$key"
}

# Copies up to the cap of matching files out of the cache into the corpus,
# flattening the tree so a name collision cannot silently drop a file.
collect() {
  local package="$1" pattern="$2" cap="${FILE_CAP[$1]}"
  shift 2
  local dest="$CORPUS/$package"
  rm -rf "$dest"
  mkdir -p "$dest"

  local count=0
  for root in "$@"; do
    [ -d "$root" ] || continue
    while IFS= read -r file; do
      [ "$count" -ge "$cap" ] && break
      # Flattened with the path in the name: the corpus is read by a walker that
      # only needs unique names, and a flat directory makes it easy to delete one
      # troublesome file by hand while bisecting a regression.
      local flat="${file#"$root"/}"
      cp "$file" "$dest/${flat//\//__}"
      count=$((count + 1))
    done < <(find "$root" -name "$pattern" -size +1k -size -120k | sort)
    [ "$count" -ge "$cap" ] && break
  done

  echo "$package: $count files"
}

want() { [ "$#" -eq 0 ] && return 0; for arg in "${REQUESTED[@]}"; do [ "$arg" = "$1" ] && return 0; done; return 1; }

REQUESTED=("$@")
want_any() { [ "${#REQUESTED[@]}" -eq 0 ] || want "$1"; }

if want_any ruby; then
  # RuboCop's own sources: idiomatic, heavily nested, and the tool that formats
  # them is half of what this package runs.
  fetch rubocop https://github.com/rubocop/rubocop.git v1.81.6
  collect ruby '*.rb' "$CACHE/rubocop/lib" "$CACHE/rubocop/spec"
fi

if want_any java; then
  # Guava, which is also the java package's conformance corpus.
  fetch guava https://github.com/google/guava.git v33.5.0
  collect java '*.java' "$CACHE/guava/guava/src" "$CACHE/guava/guava-tests"
fi

if want_any kotlin; then
  # kotlinx.coroutines, part of the kotlin package's conformance corpus.
  fetch coroutines https://github.com/Kotlin/kotlinx.coroutines.git 1.10.2
  collect kotlin '*.kt' "$CACHE/coroutines/kotlinx-coroutines-core" "$CACHE/coroutines/integration"
fi

if want_any csharp; then
  # CSharpier's own sources, which is the tool this package runs.
  fetch csharpier https://github.com/belav/csharpier.git 1.3.0
  collect csharp '*.cs' "$CACHE/csharpier/Src"
fi
