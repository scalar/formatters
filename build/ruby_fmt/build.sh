#!/usr/bin/env bash
# Bakes CRuby + syntax_tree + RuboCop into the single compressed wasm artifact
# shipped by @scalar/ruby-fmt.
#
# One artifact rather than two: both tools are Ruby, and a second artifact would
# mean a second copy of CRuby (~20MB expanded) and a second VM in any process
# that used both.
#
# Requires Ruby and bundler (build time only) - consumers of the package need
# nothing but Node. The artifact is committed, so this only needs rerunning when
# the Ruby version or the pinned gems in ./Gemfile change. Commit the result:
# the bytes in git are the bytes the tests run against.
#
# Expect the first run to take ~20 minutes: rbwasm downloads the wasi-sdk
# toolchain and builds CRuby from source. Later runs reuse ./build and only
# repackage, which is a couple of minutes.
set -euo pipefail
cd "$(dirname "$0")"

RUBY_VERSION="${RUBY_VERSION:-3.4}"
OUT="../../packages/ruby/ruby_fmt.wasm.br"
BUILD_ID="ruby-${RUBY_VERSION}-wasm32-unknown-wasip1-full"

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
# gemspecs, so any `gem "name", ">= x"` in gem code raises - which is one of the
# reasons the Gemfile pins RuboCop where it does. See the comments there.
#
# `prism` is still stripped because rubocop-ast is held at 1.42.0, the last
# release that does not need it. Raising that pin means keeping prism here.
RUBY_LIB="build/wasm32-unknown-wasip1/${BUILD_ID}-"*/install/usr/local/lib/ruby
for dir in $RUBY_LIB; do
  rm -rf "$dir"/3.4.0/{rdoc,bundler,prism,irb,reline} \
    "$dir"/gems/3.4.0/{gems,cache}
done

# The tarball under rubies/ is a cache keyed by build id, not by tree contents,
# so it has to go or the repackage silently reuses the unstripped copy.
rm -rf rubies/"${BUILD_ID}"-*.tar.gz rubies/"${BUILD_ID}"-*/

bundle exec rbwasm build \
  --ruby-version "$RUBY_VERSION" \
  --build-profile full \
  -o ruby_fmt.raw.wasm

# rbwasm downloads binaryen for its own use; reuse that copy rather than making
# contributors install one and version-match it.
WASM_OPT="build/toolchain/binaryen/bin/wasm-opt"
"$WASM_OPT" -Os --strip-debug --strip-producers ruby_fmt.raw.wasm -o ruby_fmt.opt.wasm

# Ship it brotli-compressed. The artifact is mostly Ruby source text and packs
# down about 7x, which is the difference between a ~36MB and a ~5MB install.
# Quality 11 takes a minute or so here and costs the consumer nothing - the
# runtime decompresses once per process, in ~100ms.
node -e '
  const fs = require("node:fs"), zlib = require("node:zlib")
  const raw = fs.readFileSync("ruby_fmt.opt.wasm")
  fs.writeFileSync(process.argv[1], zlib.brotliCompressSync(raw, { params: {
    [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
    [zlib.constants.BROTLI_PARAM_LGWIN]: 24,
    [zlib.constants.BROTLI_PARAM_SIZE_HINT]: raw.length,
  }}))
' "$OUT"

rm -f ruby_fmt.raw.wasm ruby_fmt.opt.wasm

echo "built $(du -h "$OUT" | cut -f1) -> packages/ruby/ruby_fmt.wasm.br"
