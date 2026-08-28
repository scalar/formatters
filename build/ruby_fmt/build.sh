#!/usr/bin/env bash
# Bakes CRuby + syntax_tree + RuboCop into the single compressed wasm artifact
# shipped by @scalar/ruby-fmt.
#
# One artifact rather than two: both tools are Ruby, and a second artifact would
# mean a second copy of CRuby (~20MB expanded) and a second VM in any process
# that used both.
#
# Requires Ruby, bundler and Bun (build time only) - consumers of the package
# need nothing but Node. Bun is here for ./preinit.ts, which imports the
# package's own TypeScript so that the Ruby baked into the artifact is the Ruby
# the runtime documents. The artifact is committed, so this only needs rerunning
# when the Ruby version, the pinned gems in ./Gemfile, or anything ./preinit.ts
# bakes in changes. Commit the result: the bytes in git are the bytes the tests
# run against.
#
# Expect the first run to take ~20 minutes: rbwasm downloads the wasi-sdk
# toolchain and builds CRuby from source. Later runs reuse ./build and only
# repackage, which is a couple of minutes.
set -euo pipefail
cd "$(dirname "$0")"

RUBY_VERSION="${RUBY_VERSION:-4.0}"
OUT="../../packages/ruby/ruby_fmt.wasm.br"
BUILD_ID="ruby-${RUBY_VERSION}-wasm32-unknown-wasip1-full"

# The pre-initializer. Pinned, like everything else that decides the artifact's
# bytes: wizer serializes a whole initialized linear memory, so its version is
# as load-bearing here as the Ruby version is.
WIZER_VERSION="7.0.5"

# The binaryen that supplies wasm-merge. Pinned like wizer, and separate from the
# one rbwasm fetches for wasm-opt: that one is version 108, which has no
# wasm-merge at all. Any release from 111 on carries the tool.
BINARYEN_VERSION="116"

# The stdlib directory CRuby installs into, which is the x.y.0 of the release
# rather than the release itself - 4.0.6 would still be 4.0.0 here. Derived from
# RUBY_VERSION so that a bump has one place to change rather than three.
RUBY_LIB_VERSION="${RUBY_VERSION}.0"

bundle install

# The `full` profile, not `minimal`. Minimal compiles no default extensions at
# all, and syntax_tree needs Ripper - a minimal build gets all the way to
# `require "syntax_tree"` before failing with `cannot load such file -- ripper`.
# There is no flag for "minimal plus ripper": RUBY_WASM_ADDITIONAL_EXTS is only
# consulted for the full profile.
#
# No --without-stdlib here on purpose. `enc` is the only component the packager
# accepts, and it is a no-op for this build: it deletes encoding .so files, but
# a static wasm build compiles the encodings into the binary, so the artifact
# came out at exactly 47.97MB with and without it. The stripping below is what
# actually works.
bundle exec rbwasm build \
  --ruby-version "$RUBY_VERSION" \
  --build-profile full \
  -o /dev/null

# Drop stdlib the formatter never loads, then repackage.
#
# This has to happen against the *install* tree. rbwasm packages from
# `build/<target>/<build-id>/install`, not from the extracted copy under
# `rubies/` - stripping the latter changes nothing and the artifact comes out
# byte-identical, which is a confusing way to lose an hour.
#
# The list came from dumping $LOADED_FEATURES after a real format - 72 files for
# syntax_tree alone, 618 once RuboCop is loaded - none of them in these
# directories. `rubygems` stays because Ruby loads it during
# startup; `specifications/` stays because the default-gem specs under it back
# did_you_mean, error_highlight and syntax_suggest, which do load. The bundled
# gems (rake, minitest, rexml, net-imap, typeprof...) are unreachable from a
# formatting call - our own gems come from /bundle via $LOAD_PATH, and the
# generated /bundle/setup.rb is nothing but `$:.unshift` lines, so it needs
# neither bundler nor an installed-gem tree.
#
# Two consequences of that last point are worth knowing before editing this
# list. `racc` is in the bundled-gem tree and RuboCop's parser does need it,
# which is why the Gemfile pulls it from rubygems instead: as a bundle gem it
# lands in /bundle and survives this. And a load-path-only bundle has no
# gemspecs, so any `gem "name", ">= x"` in gem code raises - which prism's
# parser translation does, so the VM writes a spec per packaged gem before it
# loads RuboCop. See `src/rubocop.ts`.
#
# `prism` is *not* stripped, though it used to be. rubocop-ast requires it and
# subclasses its parser translation at load time, so `require "prism"` has to
# find the default gem's Ruby files here - the C extension is compiled in
# either way. See prism_placeholder/prism.gemspec.
RUBY_LIB="build/wasm32-unknown-wasip1/${BUILD_ID}-"*/install/usr/local/lib/ruby
for dir in $RUBY_LIB; do
  rm -rf "$dir"/"$RUBY_LIB_VERSION"/{rdoc,bundler,irb,reline} \
    "$dir"/gems/"$RUBY_LIB_VERSION"/{gems,cache}
done

# The tarball under rubies/ is a cache keyed by build id, not by tree contents,
# so it has to go or the repackage silently reuses the unstripped copy.
rm -rf rubies/"${BUILD_ID}"-*.tar.gz rubies/"${BUILD_ID}"-*/

bundle exec rbwasm build \
  --ruby-version "$RUBY_VERSION" \
  --build-profile full \
  -o ruby_fmt.raw.wasm

# rbwasm downloads binaryen for its own use; reuse that copy for wasm-opt rather
# than making contributors install one and version-match it.
WASM_OPT="build/toolchain/binaryen/bin/wasm-opt"
"$WASM_OPT" -Os --strip-debug --strip-producers ruby_fmt.raw.wasm -o ruby_fmt.opt.wasm

# wasm-merge, on the other hand, has to be fetched: the binaryen rbwasm brings
# is version 108, which predates the tool entirely, so `preinit.ts` fell over on
# an ENOENT naming a path that simply has no wasm-merge in it. Pinned and fetched
# beside wizer, on the same reasoning and with the same interrupted-download
# guard - and pinned for a second reason, which is that the two tools have to
# agree about the module they hand each other.
BINARYEN_DIR="build/toolchain/binaryen-merge"
if [ ! -x "$BINARYEN_DIR/bin/wasm-merge" ]; then
  case "$(uname -s)-$(uname -m)" in
    Linux-x86_64) BINARYEN_TARGET="x86_64-linux" ;;
    Linux-aarch64 | Linux-arm64) BINARYEN_TARGET="aarch64-linux" ;;
    Darwin-x86_64) BINARYEN_TARGET="x86_64-macos" ;;
    Darwin-arm64) BINARYEN_TARGET="arm64-macos" ;;
    *)
      echo "binaryen publishes no build for $(uname -s)-$(uname -m)" >&2
      exit 1
      ;;
  esac

  rm -rf "$BINARYEN_DIR.incoming"
  mkdir -p "$BINARYEN_DIR.incoming"
  curl -sSfL "https://github.com/WebAssembly/binaryen/releases/download/version_${BINARYEN_VERSION}/binaryen-version_${BINARYEN_VERSION}-${BINARYEN_TARGET}.tar.gz" |
    tar -xz -C "$BINARYEN_DIR.incoming" --strip-components 1
  rm -rf "$BINARYEN_DIR"
  mv "$BINARYEN_DIR.incoming" "$BINARYEN_DIR"
fi
export WASM_MERGE="$PWD/$BINARYEN_DIR/bin/wasm-merge"

# Fetch wizer beside binaryen, for the same reason: a contributor rebuilding this
# artifact should not also have to install a pre-initializer and match its
# version. Cached by executable, so a second run downloads nothing, and confined
# to build/toolchain/ - which is gitignored build scratch, like the rest of it.
WIZER_DIR="build/toolchain/wizer"
if [ ! -x "$WIZER_DIR/wizer" ]; then
  case "$(uname -s)-$(uname -m)" in
    Linux-x86_64) WIZER_TARGET="x86_64-linux" ;;
    Linux-aarch64 | Linux-arm64) WIZER_TARGET="aarch64-linux" ;;
    Darwin-x86_64) WIZER_TARGET="x86_64-macos" ;;
    Darwin-arm64) WIZER_TARGET="aarch64-macos" ;;
    *)
      echo "wizer publishes no build for $(uname -s)-$(uname -m)" >&2
      exit 1
      ;;
  esac

  # Unpacked beside the cache and moved into place only once the whole stream
  # has been read, because the check above is "is there an executable here" and
  # a download interrupted mid-member can leave one that is not a whole binary.
  # `set -e` aborts the interrupted run either way; what this prevents is the
  # *next* run skipping the download and executing the truncated copy.
  rm -rf "$WIZER_DIR.incoming"
  mkdir -p "$WIZER_DIR.incoming"
  curl -sSfL "https://github.com/bytecodealliance/wizer/releases/download/v${WIZER_VERSION}/wizer-v${WIZER_VERSION}-${WIZER_TARGET}.tar.xz" |
    tar -xJ -C "$WIZER_DIR.incoming" --strip-components 1
  rm -rf "$WIZER_DIR"
  mv "$WIZER_DIR.incoming" "$WIZER_DIR"
fi

# Boot CRuby, load syntax_tree and RuboCop, and serialize the resulting linear
# memory back into the module - so that the runtime instantiates a VM that is
# already up instead of paying ~9s to require both gems, and paying it again
# every time formatting's memory leak forces a recycle.
#
# The step is its own script because it needs the package's own sources: the
# program it runs inside the VM is `RUBOCOP_SETUP` from src/rubocop.ts, and the
# directories it hands wizer are the ones src/boot-vm.ts and src/wasi-shims.ts
# name. Those preopens are the part that is easy to get wrong - the guest's
# preopen table is captured in the snapshot, so mapping them differently here
# produces an artifact that boots, formats with syntax_tree, and then dies on
# the first RuboCop call with `Errno::ENOENT @ dir_s_mkdir - /work`. See the
# header of ./preinit.ts.
#
# It costs the artifact size: ~37MB expanded becomes ~67MB, and ~5.2MB
# compressed becomes ~12.2MB. That is the trade, and it is the reason this is a
# step here rather than something the runtime could opt into.
#
# It also costs byte reproducibility. CRuby seeds its Hash function from
# `random_get` during startup, and the snapshot is a dump of the heap those
# hashes live in, so two runs over identical input differ in most of their
# bytes while behaving identically. Rebuilding and diffing against the committed
# artifact proves nothing; run the corpus comparison CONTRIBUTING.md describes
# instead.
bun preinit.ts ruby_fmt.opt.wasm ruby_fmt.preinit.wasm

# Ship it brotli-compressed. The artifact is mostly Ruby source text and a
# serialized Ruby heap, and packs down about 5.5x. Quality 11 takes a few
# minutes here and costs the consumer nothing - the runtime decompresses once
# per process, in ~250ms.
node -e '
  const fs = require("node:fs"), zlib = require("node:zlib")
  const raw = fs.readFileSync("ruby_fmt.preinit.wasm")
  fs.writeFileSync(process.argv[1], zlib.brotliCompressSync(raw, { params: {
    [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
    [zlib.constants.BROTLI_PARAM_LGWIN]: 24,
    [zlib.constants.BROTLI_PARAM_SIZE_HINT]: raw.length,
  }}))
' "$OUT"

rm -f ruby_fmt.raw.wasm ruby_fmt.opt.wasm ruby_fmt.preinit.wasm

echo "built $(du -h "$OUT" | cut -f1) -> packages/ruby/ruby_fmt.wasm.br"
