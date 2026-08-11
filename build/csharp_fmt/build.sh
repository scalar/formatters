#!/usr/bin/env bash
# Compiles CSharpier to the wasm artifacts an @scalar/csharp-fmt package would ship.
#
# Requires nothing preinstalled: the .NET SDK and its wasm-tools workload are
# downloaded into ./toolchain, which is gitignored. Set DOTNET_ROOT to reuse an
# SDK you already have. Expect ~10 minutes on a cold run, almost all of it the
# 235MB SDK download and the ~1.5GB workload.
#
# Output goes to packages/csharp. NOTES.md records what was measured and why the
# build is configured the way it is; read it before changing a flag.
set -euo pipefail
cd "$(dirname "$0")"

DOTNET_VERSION="${DOTNET_VERSION:-10.0}"
CSHARPIER_VERSION="${CSHARPIER_VERSION:-1.3.0}"
# Ships the wasmconsole template. The templates are not part of the SDK or the
# workload; they are a separate NuGet package, versioned per TFM.
TEMPLATES_VERSION="${TEMPLATES_VERSION:-10.0.10}"

TOOLCHAIN="$PWD/toolchain"
OUT_DIR="../../packages/csharp"

if [ -z "${DOTNET_ROOT:-}" ]; then
  DOTNET_ROOT="$TOOLCHAIN/dotnet"
  if [ ! -x "$DOTNET_ROOT/dotnet" ]; then
    echo "fetching .NET SDK $DOTNET_VERSION"
    mkdir -p "$TOOLCHAIN"
    curl -fsSL -o "$TOOLCHAIN/dotnet-install.sh" https://dot.net/v1/dotnet-install.sh
    chmod +x "$TOOLCHAIN/dotnet-install.sh"
    "$TOOLCHAIN/dotnet-install.sh" --channel "$DOTNET_VERSION" --install-dir "$DOTNET_ROOT" --no-path
  fi
fi
export DOTNET_ROOT
export PATH="$DOTNET_ROOT:$PATH"
export DOTNET_CLI_TELEMETRY_OPTOUT=1
export DOTNET_NOLOGO=1

# wasm-tools is what carries the browser-wasm runtime pack and Emscripten. The
# `dotnet publish` below fails without it, so install it rather than assume it.
if ! dotnet workload list 2>/dev/null | grep -q wasm-tools; then
  echo "installing wasm-tools workload (~1.5GB)"
  dotnet workload install wasm-tools
fi

rm -rf work
mkdir -p work
cp CSharpFmt.cs csharp_fmt.csproj main.mjs work/

# The SDK will not publish a browser-wasm app without a main JS file on disk,
# even though nothing here uses it: the package supplies its own loader. It is
# copied in above so the property has something to point at.
(cd work && dotnet publish -c Release -p:CSharpierVersion="$CSHARPIER_VERSION")

BUNDLE="work/bin/Release/net10.0/browser-wasm/AppBundle/_framework"

# Everything in _framework is load-bearing except the debug sidecars, and it
# splits in two. The .js files are ES modules the runtime imports by URL, so
# they have to stay real files. Everything else - assemblies, the runtime wasm,
# the ICU data - is fetched through the resource loader the package installs,
# which means it can be handed bytes instead. That half packs into one archive
# and compresses 21MB down to about 4.2MB.
node -e '
  const fs = require("node:fs"), zlib = require("node:zlib"), path = require("node:path")
  const [bundle, outDir] = process.argv.slice(1)

  const shipped = fs
    .readdirSync(bundle)
    .filter((name) => !name.endsWith(".map") && !name.endsWith(".symbols"))
    .sort()

  fs.rmSync(path.join(outDir, "runtime"), { recursive: true, force: true })
  fs.mkdirSync(path.join(outDir, "runtime"), { recursive: true })

  // A tiny archive rather than tar: a length-prefixed JSON index of
  // {name: [offset, length]} followed by the bytes. The loader needs random
  // access by asset name and nothing else, and this keeps the reader in the
  // package down to a few lines with no dependency.
  const index = {}
  const chunks = []
  let offset = 0
  let jsBytes = 0

  for (const name of shipped) {
    const bytes = fs.readFileSync(path.join(bundle, name))
    if (name.endsWith(".js")) {
      fs.writeFileSync(path.join(outDir, "runtime", name), bytes)
      jsBytes += bytes.length
      continue
    }
    index[name] = [offset, bytes.length]
    offset += bytes.length
    chunks.push(bytes)
  }

  const header = Buffer.from(JSON.stringify(index), "utf8")
  const headerLength = Buffer.alloc(4)
  headerLength.writeUInt32LE(header.length)
  const archive = Buffer.concat([headerLength, header, ...chunks])

  const compressed = zlib.brotliCompressSync(archive, { params: {
    [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
    [zlib.constants.BROTLI_PARAM_LGWIN]: 24,
    [zlib.constants.BROTLI_PARAM_SIZE_HINT]: archive.length,
  }})
  fs.writeFileSync(path.join(outDir, "csharp_fmt.br"), compressed)

  const mb = (n) => (n / 1048576).toFixed(2) + "MB"
  console.log(
    `built ${Object.keys(index).length} assets, ${mb(archive.length)} -> ${mb(compressed.length)} ` +
      `csharp_fmt.br, plus ${mb(jsBytes)} of runtime JavaScript -> packages/csharp`,
  )
' "$BUNDLE" "$OUT_DIR"
