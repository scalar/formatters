# `@scalar/csharp-fmt` — performance

What was measured, what changed, and what was tried and rejected. Every number
here was taken on one machine (4 shared vCPUs, 16GB, Linux 6.18, Node 22.22.2,
bun 1.3.11) that was **busy throughout** — two other agents were running their
own benchmarks on the same four cores, load average 4–6. So absolute numbers run
20–60% higher than the same code on an idle box, and nothing below should be
compared against a number taken elsewhere. Every comparison that matters is
**interleaved**: the two sides alternate run by run, so the machine's drift lands
on both of them rather than on whichever went second.

## 1. Native CSharpier, and where each side wins

The interesting comparison for this package is not against the other packages in
this repo. It is against the tool it *is*: `csharpier` 1.3.0 running on .NET,
which has costs of its own — a process to start, a JIT to warm — that a resident
wasm module does not pay twice.

```bash
# once
curl -fsSL https://dot.net/v1/dotnet-install.sh | bash -s -- --channel 10.0 --install-dir ~/dotnet-sdk --no-path
export DOTNET_ROOT=~/dotnet-sdk PATH="$HOME/dotnet-sdk:$HOME/.dotnet/tools:$PATH"
dotnet tool install -g csharpier --version 1.3.0

# then
bun run build
bun run scripts/bench/native-csharpier.ts --reps 3
bun run scripts/bench/native-csharpier.ts --reps 3 --counts 25,50,100
```

Total wall clock to format N files of CSharpier's own source, median of 3. The
two blocks are two separate runs of the script, minutes apart on a machine whose
load was moving, so compare down a column within a block rather than across the
rule:

| files | native one-shot | native one-shot `--skip-validation` | native warm (server) | package one-shot | package warm |
|------:|----------------:|------------------------------------:|---------------------:|-----------------:|-------------:|
| 1     | 477ms           | 496ms                               | 28.1ms               | 738ms            | **10.5ms**   |
| 10    | 915ms           | 863ms                               | **165ms**            | 1072ms           | 176ms        |
| 168   | 3736ms          | 3922ms                              | 2102ms               | **2307ms**       | **1366ms**   |
| — | | | | | |
| 25    | 1275ms          | 1121ms                              | 589ms                | **1205ms**       | **308ms**    |
| 50    | 1809ms          | 1763ms                              | 752ms                | **1651ms**       | **528ms**    |
| 100   | 2511ms          | 2704ms                              | 1308ms               | **1862ms**       | **658ms**    |

`csharpier server` itself takes 163–224ms to come up, which the warm column does
not charge to either side — both are warmed with one format before anything is
timed.

Read plainly:

- **One file, cold, is native's win.** 477ms against 738ms. The package pays
  ~310ms of boot and ~120ms of first-format warm-up before it formats anything,
  and there is nothing to amortise it against.
- **A whole project, cold, is the package's win**, and by a lot: 2.3s against
  3.7s for 168 files — while native `csharpier format` is using all four cores
  and the package is using one. Native's fixed cost (process start, JIT, file
  discovery, `.csharpierrc` and `.editorconfig` resolution, the MSBuild version
  check) is around 1.4s of that 3.7s; the package pays its fixed cost once and
  then formats at 8ms a file.
- **The crossover is at about 25 files** — 1205ms against 1275ms, which is close
  enough to call a tie, with the package clearly ahead by 50 (1651 vs 1809) and
  100 (1862 vs 2511). Below 25 native's one-shot is ahead.
- **Warm, the package wins everywhere except a statistical tie at 10 files.**
  2.7x at one file (10.5ms against 28.1ms — the difference is a localhost HTTP
  round trip and a per-file config lookup that the package's caller does not
  make), 1.9x at 25 and 50, and 1.5x over the whole corpus (8.1ms a file against
  12.5ms).
- `--skip-validation` changes nothing outside noise, so CSharpier 1.3.0 is not
  re-parsing its own output by default and there is no hidden work to subtract
  from the native side.

The honest one-line version: **if you format one file from a cold shell, the
real tool is 1.5x faster; if you format a project, or you hold the module open,
this package is 1.5–2.7x faster.**

## 2. Where the 513ms boot goes

Attributed by instrumenting each phase in a fresh Node process, then by
timestamping the runtime's own `withDiagnosticTracing` output. On this loaded
machine the same boot measures ~405ms under Node and ~690ms under bun; the
proportions are what matter.

| phase | ms (Node, before) | what it is |
|---|---:|---|
| `readFileSync` of `csharp_fmt.br` | 3 | 4.4MB off disk |
| `brotliDecompressSync` | 120 | 4.4MB → 21MB |
| index parse | 0.1 | the JSON header |
| `import('dotnet.js')` | 4 | plus ~12ms for `dotnet.runtime.js` and `dotnet.native.js` inside `create()` |
| `dotnet.create()` | 295 | see below |
| `getAssemblyExports` | 9 | binding the one `[JSExport]` |

And inside `create()`:

| | ms | |
|---|---:|---|
| handing 21MB to the runtime through `Response` | **~95** | 62ms of it is the *first* `Response` in the process, which is what makes Node load its `fetch` implementation; ~35ms is reading the bodies back out |
| compiling `dotnet.native.wasm` | 20–60 | 16.2MB, and V8 compiles it lazily — see below |
| instantiate, `mono_wasm_load_runtime`, assembly registration, ICU | ~120 | the .NET runtime's own startup |
| the four `runtime/*.js` module imports | 14 | measured directly: 2.1 / 0.6 / 6.7 / 4.9ms |

Things the leads asked about, answered:

- **Every asset in the archive is reached.** All 20 binary entries are requested
  during boot, none is dead weight. (The three `.js` entries the runtime asks the
  loader for are deliberately answered `undefined`, so it resolves them by URL.)
- **ICU is not deferrable from this side.** `icudt.dat` is listed in the boot
  manifest, so withholding it does not make the runtime skip it — it makes the
  runtime try to fetch it from disk and fail the boot. Its cost is bounded by its
  share of the decompression (1.5MB of 21MB, so ~7ms) plus one copy into the wasm
  heap. Making it lazy would need a rebuild with a different `globalizationMode`,
  and `build/csharp_fmt/NOTES.md` already establishes that invariant mode
  reorders using directives.
- **Decompression cannot usefully overlap the runtime import.** The import is
  4ms. Moving decompression onto the libuv threadpool with the async
  `zlib.brotliDecompress` so the two could overlap made it *slower*: 193ms
  against 112ms, measured, because the threadpool round trip costs more than the
  4ms it could hide.
- **V8's lazy wasm compilation is already saving the boot 240ms.**
  `node --no-wasm-lazy-compilation` moves boot from 295ms to 536ms and saves only
  26ms of the first format. There is no pre-JIT hint to add here; the engine is
  already deferring as much as it can.

## 3. Where the first format goes

The first format costs ~120ms under Node (~290ms under bun) against a ~4ms
steady state. Of that:

- **~26ms is V8 compiling wasm functions the boot deferred.** That is the exact
  difference `--no-wasm-lazy-compilation` makes to the first format, and it is a
  bad trade — it costs 240ms of boot to save it.
- **~95ms is Mono and Roslyn doing first-call work**: class initialisers, AOT
  method resolution, Roslyn's lexer tables. This is what
  `build/csharp_fmt/NOTES.md` calls the "~0.8s first call" from the other side of
  the AOT switch.

It cannot be pre-paid cheaply, which is the finding that matters. A warm-up
format inside `init()` was measured five times each way, interleaved:

| runtime | init | boot | first format | boot + first |
|---|---|---:|---:|---:|
| node | plain | 293.6ms | 109.6ms | **403.3ms** |
| node | warm-up inside `init` | 410.0ms | 96.6ms | 506.9ms |
| bun | plain | 594.9ms | 288.8ms | **895.3ms** |
| bun | warm-up inside `init` | 793.3ms | 273.9ms | 1067.2ms |

The warm-up costs 116ms (Node) and 198ms (bun) and gives back 13ms and 15ms. It
does not move the cost, it pays it twice: formatting `class Warmup { }` touches
almost none of the code paths a real file needs, so the real file still compiles
and initialises nearly everything itself. **Not shipped.**

## 4. The JS/wasm boundary is not the problem

`[JSExport]` marshals the source in and the result out as real strings. Measured
by formatting sources of increasing size, one a single long comment (which
Roslyn lexes in one pass, so the cost is dominated by the two marshals) and one
real code:

| size | one long comment | real code |
|---|---:|---:|
| 1KB | 0.21ms | 4.9ms |
| 16KB | 0.43ms | 63.7ms |
| 64KB | 1.55ms | 254.9ms |
| 256KB | 4.51ms | 983.5ms |
| 1MB | 18.1ms | — |

The boundary plus a full lex runs at ~55 MB/s; real formatting runs at
~0.25 MB/s. So the boundary is about **0.5% of a format**, and at the corpus's
median file size (5.2KB) it is ~0.1ms of a 4.4ms format. There is nothing to win
here, and in particular nothing that would justify the Java package's
encoded-string boundary.

## 5. What changed

Two changes, both in the package's JavaScript, neither touching the wasm
artifact — so output cannot move, and the evidence in §6 confirms it did not.

### Assets are handed over directly instead of through a `Response`

`load-artifact.ts` and `fetch-artifact.ts` used to answer the runtime's resource
loader with `new Response(bytes)`. The runtime reads five things off that answer
— `ok`, `status`, `statusText`, `url`, `arrayBuffer()` — and `src/asset-response.ts`
now supplies exactly those as a plain object. `types.ts` gains an `AssetResponse`
type describing that shape; a real `Response` still satisfies it.

This is worth ~95ms under Node for two reasons that have nothing to do with the
bytes: constructing the first `Response` in a Node process is what makes Node
load its `fetch` implementation (62ms, measured on its own), and reading 21MB
back out of response bodies cost another ~35ms of stream machinery on top of a
copy we were going to make anyway.

### The archive is expanded in one chunk

`node:zlib` fills 16KB output buffers by default and concatenates them at the
end — for a 21MB archive that is 1300+ allocations and a 21MB stitch.
`{ chunkSize: 24 * 1024 * 1024 }` costs nothing and is worth ~20ms:

| | ms |
|---|---:|
| `brotliDecompressSync(archive)` | 121.7 |
| `… { chunkSize: 1MB }` | 104.3 |
| `… { chunkSize: 24MB }` | **99.4** |

### What it bought

Four passes, alternating the committed build and the new one so the machine's
load lands on both, formatting all 168 usable corpus files each time:

| runtime | build | boot | first format | median format | KB/s |
|---|---|---:|---:|---:|---:|
| node | committed | 412.9ms | 120.5ms | 4.41ms | 766 |
| node | **new** | **311.1ms** | 122.4ms | 4.28ms | 770 |
| bun | committed | 742.9ms | 322.4ms | 4.87ms | 638 |
| bun | **new** | **660.0ms** | 366.1ms | 4.72ms | 631 |

**Node boot: −96ms, −24%**, and every one of the four passes agreed. Formatting
is untouched, as it must be — nothing on the per-format path changed.

Under **bun** the same change is roughly neutral (−80ms at the median, but inside
the run-to-run spread), because bun's `Response` is native and has no lazy
`fetch` implementation to load. That is worth stating plainly, because
`bun run bench csharp` measures bun while the package's stated constraint is
plain Node — the win is real and it lands on the runtime consumers actually use,
but the repo's own benchmark table is the place least likely to show it.

## 6. Conformance — the output did not move

| check | result |
|---|---|
| `bun test packages/csharp`, with native csharpier 1.3.0 on PATH | 35 pass, 0 fail — the 16 `native-conformance` cases run rather than skip |
| whole benchmark corpus, package against native `csharpier format` 1.3.0 | **168 byte-identical, 0 differ**, 1 excluded (`CSharpier.Benchmarks__CodeSamples__Code.cs`, whose contents are C# escaped inside C# string literals — neither side parses it, and `NOTES.md` records it as one of the two files dropped from the 613-file corpus) |
| old transport against new transport, both booted in one process, whole corpus | **169 identical, 0 differ** |
| `bun run test` | all 7 packages pass |
| `bun run test:node` | 18 pass, 3 skip, 0 fail |
| `bun run test:browser` | all 7 browser cases pass, C# included — and that test asserts the browser output is byte-identical to Node, which is what covers the `fetch-artifact.ts` half of the change |
| `bun run types:check`, `bun run check` | clean |

The wasm artifact was **not rebuilt**, so `TrimMode=full` and the 613-file
evidence behind it are untouched.

## 7. Tried, and rejected

| idea | result |
|---|---|
| `Content-Type: application/wasm` on the wasm response, to reach `WebAssembly.compileStreaming` | No change (245ms vs 259ms inside `create()`, inside the noise). The bytes are already in hand, so there is no download for a streaming compile to overlap with. |
| async `zlib.brotliDecompress` on the threadpool, overlapped with the runtime import | **Worse**: 193ms against 112ms. The import it could hide behind is only 4ms. |
| a warm-up format inside `init()` | **Worse by ~100ms** on boot + first format, on both runtimes. See §3. |
| `--no-wasm-lazy-compilation` | Diagnostic only, and it confirms the engine is right: +240ms boot to save 26ms of first format. |
| withholding `icudt.dat` to make ICU lazy | Not possible from the loader — the boot manifest lists it, so `undefined` means "fetch it from disk", and the boot fails. |
| shrinking the archive by dropping assemblies | Nothing to drop: all 20 binary assets are requested during boot. |

## 8. Not attempted here, and what it would be worth

All of these need the artifact rebuilt, which needs .NET 10 plus the
`wasm-tools` workload (~1.5GB on top of the 235MB SDK) and an AOT publish that
`NOTES.md` puts at ~10 minutes on an idle machine — on this one, sharing four
cores with two other agents, realistically 30–45 minutes. And the rule is
absolute: any rebuild has to re-run the 613-file corpus, because trimming is only
checkable by running. That did not fit alongside getting the native comparison
right, which was the point of the exercise. Estimates, in the order I would try
them:

- **`WasmStripILAfterAOT`.** Drops the IL from the 4.3MB of assemblies once they
  are AOT-compiled. Worth maybe 20ms of decompression and a smaller download.
  The risk is real and only findable by running: any method that falls back to
  the interpreter has no IL left to interpret.
- **An AOT profile (`WasmAotProfilePath`).** Would shrink the 16.2MB
  `dotnet.native.wasm`, which is 73% of what gets decompressed. Halving it saves
  ~37ms of decompression and some instantiation. But V8 already compiles that
  module lazily (§2), so the compile side of the saving is mostly imaginary,
  while everything left out of the profile drops to the interpreter — which
  `NOTES.md` measures at 4x. I expect this to be net-negative and would want the
  numbers before believing otherwise.
- **Per-call work in `CSharpFmt.cs`.** `CodeFormatterOptions` is constructed per
  format. At 4ms a format against an object with four scalar fields, this is
  noise; it is on the list only because it was asked about.

One thing that does *not* need a rebuild and might be worth a look later:
`dotnet.native.wasm` is 73% of the archive, and it is the one asset whose
`arrayBuffer()` copy could be avoided by storing it as its own brotli member with
its own buffer. That is ~10ms, against a change to the committed archive format
and to both readers. Not obviously worth it.
