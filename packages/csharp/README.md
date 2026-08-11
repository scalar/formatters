# Scalar C# Formatter

[![Version](https://img.shields.io/npm/v/%40scalar%2Fcsharp-fmt)](https://www.npmjs.com/package/@scalar/csharp-fmt)
[![Downloads](https://img.shields.io/npm/dm/%40scalar%2Fcsharp-fmt)](https://www.npmjs.com/package/@scalar/csharp-fmt)
[![License](https://img.shields.io/npm/l/%40scalar%2Fcsharp-fmt)](https://www.npmjs.com/package/@scalar/csharp-fmt)
[![Discord](https://img.shields.io/discord/1135330207960678410?style=flat&color=5865F2)](https://discord.gg/scalar)

C# formatter that runs on plain Node. No .NET SDK, no `dotnet` on `PATH`, no postinstall download.

---

Scalar is an open-source API platform for teams who want beautiful developer interfaces without vendor lock-in.

- **[API References](https://scalar.com/products/api-references/getting-started)** — Interactive API documentation from OpenAPI and AsyncAPI specs.
- **[Developer Docs](https://scalar.com/products/docs/getting-started)** — Write in Markdown/MDX, generate API references, sync with two-way Git.
- **[SDK Generator](https://scalar.com/products/sdk-generator/getting-started)** — Type-safe SDKs and CLIs in TypeScript, Python, Go, PHP, Java, and Ruby.
- **[API Client](https://scalar.com/products/api-client/getting-started)** — Open-source, offline-first Postman alternative built on OpenAPI.

20M+ monthly npm installs · 15,500+ GitHub stars · MIT licensed · [scalar.com](https://scalar.com)

---

```bash
npm i @scalar/csharp-fmt
```

```js
import { format } from '@scalar/csharp-fmt'

await format('using B;using A;class A{int x  =  1;void F(){G( "hi" );}}')
// using A;
// using B;
//
// class A
// {
//     int x = 1;
//
//     void F()
//     {
//         G("hi");
//     }
// }
```

Async because the first call decompresses the archive and boots the runtime —
about 0.8s. That work is cached, so every later call is ~5ms.

Options: `{ printWidth }` (100), `{ useTabs }` (false), `{ indentSize }` (4) and
`{ endOfLine }` (`'auto'`, or `'lf'`/`'crlf'`). Every default is CSharpier's own,
so `format(source)` means what `csharpier format <file>` means for a file with no
`.csharpierrc` beside it.

Source that does not parse throws, carrying the diagnostics CSharpier produced:
`(1,9): error CS1513: } expected`.

**Node 22 or newer.**

## This is the real CSharpier, and the output is exact

This is **actual [CSharpier](https://github.com/belav/csharpier) 1.3.0** —
Roslyn's own C# parser included — compiled to WebAssembly by the .NET 10
`browser-wasm` toolchain. It is not a reimplementation, so it does not drift.

`test/native-conformance.test.ts` asserts byte-identical output against the same
version running on .NET. That test *asserts* rather than reports: any divergence
is a real bug. It skips cleanly when no native `csharpier` is around, so a
toolchain-free checkout still passes.

Beyond the samples in that test, the build was checked against 613 real C# files
— CSharpier's own syntax-coverage test corpus plus its source — formatted by both
the wasm build and the native CLI. All 613 came out identical.

## `format()` is a string in and a string out

For a `.cs` file the CLI dispatches straight to the same
`CSharpFormatter.Format` that runs inside the module here, so unlike this repo's
Java package there is no extra CLI pipeline to replicate. What the CLI adds
around it is a caller's job, because none of it exists inside a module with no
filesystem:

- finding files, and honouring `.csharpierignore`
- resolving `.csharpierrc` and `.editorconfig` into options — pass them yourself
- detecting a file's encoding

The one place that boundary is papered over is the byte-order mark. The library
drops a leading mark and the CLI re-attaches it from the encoding it detected,
so `format()` re-attaches it too — otherwise formatting a BOM-prefixed file
would silently strip it.

## XML is not included

CSharpier also formats `.csproj` and other XML through a separate
`XmlFormatter`. This package exposes only the C# formatter. That is a scope
choice, not a limitation of the build.

## One artifact, and how to get it

`build/csharp_fmt/build.sh` produces two things, both committed:

- `csharp_fmt.br` — the assemblies, the runtime wasm and the ICU data, packed
  into one brotli archive. 21MB raw, 4.2MB compressed.
- `runtime/` — the four JavaScript files the .NET runtime imports as ES modules.
  They resolve by URL, so they have to stay real files.

Everything in the archive is fed to the runtime through
`dotnet.withResourceLoader`, which is why 21MB of assets can ship as one
compressed file instead of twenty loose ones.

The build needs the .NET 10 SDK and its `wasm-tools` workload, which the script
downloads itself. Neither the tests nor consumers ever need them.

`build/csharp_fmt/NOTES.md` records what was measured and why the build is
configured the way it is — including two settings that silently change output,
which is worth reading before touching a flag.

## Community

We are API nerds. You too? Let's chat on Discord: <https://discord.gg/scalar>

## Licensing

Everything embedded here is permissively licensed: CSharpier, Roslyn, the .NET
runtime and class library, and Emscripten are MIT, and the ICU data is
Unicode-3.0. Unlike this repo's Java package there is no restriction on who may
redistribute a copy or what they may charge. See `licenses/NOTICE.md`.
