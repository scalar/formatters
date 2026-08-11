#!/usr/bin/env bash
# Fetches the official PHP CS Fixer phar and stores it brotli-compressed as the
# artifact shipped by @scalar/php-fmt.
#
# There is no compilation step here, and that is the point. The other packages
# in this repo compile their reference tool themselves because no wasm build of
# it exists; PHP CS Fixer is pure PHP, so the released phar *is* the tool and
# the PHP that runs it comes from @php-wasm/node-8-4. Building anything from
# source here would only introduce a copy that could drift.
#
# Requires nothing but Node and curl - no PHP install. The artifact is
# committed, so this only needs rerunning to bump PCF_VERSION. Commit the
# result: the bytes in git are the bytes the tests run against.
set -euo pipefail
cd "$(dirname "$0")"

# Pinned rather than "latest" so a rebuild is reproducible and a version bump is
# a reviewable diff. The conformance test resolves this same version from the
# artifact, so the native side and the wasm side can never silently disagree.
PCF_VERSION="${PCF_VERSION:-3.95.18}"
OUT="../../packages/php/php_fmt.phar.br"
URL="https://github.com/PHP-CS-Fixer/PHP-CS-Fixer/releases/download/v${PCF_VERSION}/php-cs-fixer.phar"

echo "downloading php-cs-fixer ${PCF_VERSION}"
curl -sSLf -o php-cs-fixer.phar "$URL"

# A phar carries its own signature over the whole file, so verify the download
# parses as one rather than trusting the transfer. `Phar` is not available here
# (no PHP install by design), so this checks the stub and the trailing signature
# marker - enough to catch a truncated download or an HTML error page saved
# under the .phar name.
node -e '
  const fs = require("node:fs")
  const buf = fs.readFileSync("php-cs-fixer.phar")
  const head = buf.subarray(0, 256).toString("latin1")
  if (!head.startsWith("#!/usr/bin/env php")) throw new Error("not a phar: unexpected stub")
  if (buf.subarray(-4).toString("latin1") !== "GBMB") throw new Error("not a phar: missing signature marker")
  console.log(`  ok, ${(buf.length / 1048576).toFixed(2)}MB`)
'

# Ship it brotli-compressed. A phar is a container of PHP source text and packs
# down about 8x, which is the difference between a 3.5MB and a 0.44MB install.
# Quality 11 takes a few seconds here and costs the consumer ~9ms once per
# process. Brotli is in node:zlib, so this adds no dependency.
node -e '
  const fs = require("node:fs"), zlib = require("node:zlib")
  const raw = fs.readFileSync("php-cs-fixer.phar")
  fs.writeFileSync(process.argv[1], zlib.brotliCompressSync(raw, { params: {
    [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
    [zlib.constants.BROTLI_PARAM_LGWIN]: 24,
    [zlib.constants.BROTLI_PARAM_SIZE_HINT]: raw.length,
  }}))
' "$OUT"

# The version the artifact actually contains, recorded next to it so the
# conformance test can download the matching native phar without a second
# source of truth to keep in step.
node -e '
  const fs = require("node:fs")
  fs.writeFileSync(process.argv[1], `${JSON.stringify({ phpCsFixer: process.argv[2] }, null, 2)}\n`)
' "../../packages/php/VERSIONS.json" "$PCF_VERSION"

rm -f php-cs-fixer.phar

echo "built $(du -h "$OUT" | cut -f1) -> packages/php/php_fmt.phar.br"
