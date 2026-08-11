# C# — build notes

This is the build behind [`@scalar/csharp-fmt`](../../packages/csharp), and the
measurements that decided how it is configured. Read it before changing a flag:
two of them change output rather than size.

Reference tool: **CSharpier 1.3.0**. Status: exact.

## Why CSharpier and not `dotnet format`

`dotnet format` is a whitespace fixer that runs over an MSBuild workspace: it
wants a `.csproj`, a restored dependency graph and a `.editorconfig`, none of
which exist inside a wasm module with no filesystem. CSharpier is the opposite
shape — it parses with Roslyn and re-prints from scratch, Prettier-style, and
its whole formatting surface is one static call:

```csharp
CSharpier.Core.CSharp.CSharpFormatter.Format(string code, CodeFormatterOptions? options)
```

String in, string out, no I/O. That is the same boundary the Ruby and Java
packages already use.

It is also the entire formatting path for a `.cs` file in the real CLI —
`CodeFormatter.FormatAsync` dispatches straight to `CSharpFormatter` — so
unlike google-java-format there is no extra CLI pipeline to replicate. What the
CLI adds around it is file discovery, `.csharpierrc`/`.editorconfig` resolution,
ignore files and encoding detection, all of which are a caller's job here.

## The route: browser-wasm, not WASI

WASI is a dead end for .NET. The `wasi-experimental` workload has been broken
for over a year and .NET 10 shipped without WASI support. The live path is
`browser-wasm` — the same Mono-on-wasm runtime Blazor uses — driven from the
`wasmconsole` template, which is explicitly a Node/V8 target rather than a
browser one. It runs under plain `node`, no flags.

`[JSExport]` gives a real typed boundary, so options cross as `int`/`bool`/
`string` instead of the encoded spec string the Java package needs.

## It works

613 real C# files formatted through the wasm build under plain Node 22, then
compared byte-for-byte against `csharpier format` 1.3.0 running natively on the
same files:

| | |
|:---|---:|
| byte-identical | 591 |
| differ only by a UTF-8 BOM | 22 |
| real divergences | **0** |

The corpus is CSharpier's own formatting test files — which exist precisely to
cover every C# construct — plus its own source: 248 and 365 respectively. Two
files were dropped from the 615 available, both bad inputs rather than
formatter failures: one is UTF-16 encoded, and one is a benchmark fixture whose
contents are C# source escaped inside C# string literals, so it does not parse.

The BOM difference is a wrapper concern, not a formatter one: the library drops
a leading `﻿` and the CLI re-attaches it from the encoding it detected. A
package has to re-attach it to match the tool. Verified directly: input with a
BOM comes back without one.

## Three things that would have shipped a silent divergence or a crash

**`InvariantGlobalization=true` reorders using directives.** It is the obvious
size knob for a wasm build and it is wrong here. CSharpier orders usings with
`StringComparison.InvariantCultureIgnoreCase`, a linguistic comparison; without
ICU, .NET degrades that to ordinal and `using SomeCompany._Word;` sorts *after*
`MWord` instead of before it. Two corpus files caught it. ICU costs ~0.8MB
brotli and is not optional.

**`TrimMode=full` is safe here, but only checkable by running.** Roslyn and
CSharpier both emit `IL2104` trim warnings, so the linker's own signal is
"maybe broken". 613 files formatting identically is the evidence that it is not.
Do not change trimming settings without re-running the corpus.

**`Diagnostic.ToString()` traps the AOT build.** Formatting source that does not
parse died with `null function or function signature mismatch` — a known Mono
wasm AOT problem with generic virtual dispatch, not something a flag fixes. The
corpus never caught it, because the two files that fail to parse were dropped
from the corpus as bad inputs; a unit test for the error path did.

A probe build with one `[JSExport]` per step established exactly how far the
path gets:

| call | AOT |
|:---|:---|
| enumerating `ErrorDiagnostics` | ok |
| `diagnostic.Id` | ok |
| `diagnostic.GetMessage()` | ok |
| `diagnostic.Location.GetLineSpan()` | ok |
| `diagnostic.ToString()` | **traps** |

So `CSharpFmt.cs` assembles the same string from the pieces rather than dropping
AOT, which would have cost 4x on every format. The severity is hardcoded to
`error` because CSharpier filters `ErrorDiagnostics` to `DiagnosticSeverity.Error`
before returning it.

## Numbers

Artifact, after trimming, one ICU file instead of three, English-only resources
and AOT:

| | raw | brotli |
|:---|---:|---:|
| 24 files in `_framework` | 21.5MB | **4.40MB** |

For scale: `ruby_fmt.wasm.br` is 3.8MB and `java_fmt.wasm.br` is 4.4MB. Before
tuning it was 23.9MB raw / 6.4MB brotli.

Timing, Node 22 on 4 cores, both builds measured on the same corpus:

| | interpreted | AOT |
|:---|---:|---:|
| boot | 140ms | 253ms |
| first `format()` after boot | 4.2s | 1.0s |
| steady state, 2.9KB file | 20ms | **5.2ms** |
| the whole 613-file corpus | 11.0s | **3.2s** |
| brotli | 2.47MB | 4.40MB |

**AOT is worth its 1.9MB** and is on in `csharp_fmt.csproj`. Without it Mono
interprets Roslyn's parser, which is where the 4.2s first call comes from.
With it the package lands at Java's size and Java's ~5ms formats, and native
`csharpier format` does the same 613 files in 1.85s across four cores against
3.2s single-threaded here. Output is unaffected: the conformance corpus was run
against both builds, 0 real divergences either way.

Memory over 3065 formats (9.8MB of input) in one process: RSS 205MB → 265MB,
with per-pass growth decelerating (28, 9, 7, 12, 4 MB). Nothing like the Ruby
package's unbounded leak, so no VM recycling looks necessary — but it was not
run to exhaustion.

## Licensing is clean

CSharpier MIT, Roslyn MIT, the .NET runtime and its wasm bits MIT, Emscripten
MIT. No GFTC-style redistribution limit like the Java package carries, so
nothing constrains who can ship a copy.

## How the artifact is packed

`WasmSingleFileBundle` would have been the tidy answer and it does not work — it
fails on Linux with `EmitBundleObjectFiles` dying on a broken pipe. So the build
packs the archive itself, and the split is forced by how the runtime loads
things:

- the four `.js` files are ES modules the runtime imports **by URL**, so they
  have to be real files on disk — 0.44MB, shipped as-is under `runtime/`
- everything else is requested through `dotnet.withResourceLoader`, which
  accepts a `Response`, so the 20 binary assets pack into one brotli archive —
  21MB down to 4.2MB

That hook is why this package needs no equivalent of the Java package's
`fs.promises.readFile` interception: the runtime has a supported way to be
handed bytes.

## Still open

- **XML.** CSharpier also formats `.csproj`/XML via `XmlFormatter`. Free to
  include, but it widens what the package claims, so it is left out.
- **The ~0.8s first call.** Better than 4.2s and fine in practice, but it is
  still the one number that loses to Java. Not chased further.
- **Encoding.** The CLI detects UTF-16 and other encodings; a `format(string)`
  API cannot. Same boundary the other packages draw, and the package README says
  so. The byte-order mark is the one part of it `format()` does handle.

## Reproducing

```bash
bun run csharp:build               # downloads the SDK + wasm-tools into ./toolchain
DOTNET_ROOT=/path/to/sdk build/csharp_fmt/build.sh   # or reuse an SDK
```
