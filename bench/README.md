# Benchmarks

Two numbers decide what a consumer waits for, and they trade against each other,
so neither one alone says whether a change helped. **Boot** is the one-time price
of getting a language runtime ready — decompressing the artifact, compiling the
module, instantiating it, loading whatever the formatter needs on top. **Format**
is the steady-state price per file once that is paid. A change that precompiles
more into the artifact moves work from the second into the first; a change that
defers loading moves it the other way.

```sh
bun run bench:corpus       # fill bench/corpus from pinned upstream checkouts
bun run bench              # every package
bun run bench ruby java    # just those
bun run bench --json       # machine-readable, for comparing two revisions
```

Every package is measured in its own process, because they all cache the
compiled module and the booted instance in a module-level binding for the life
of the process — a second boot in the same process would measure the cache.

The corpus is real source from the same projects the conformance tests use
(RuboCop, Guava, kotlinx.coroutines, CSharpier), gitignored and reproducible
from `scripts/bench/fetch-corpus.sh`. Formatter cost is superlinear in nesting
depth and expression width, so a corpus of hand-written snippets reports a
throughput no consumer will ever see.

## Where things stand

Same machine, bun, before and after the performance work. 200 files each except
C#, which has 169.

| | boot | first format | median | p95 | KB/s |
|:---|---:|---:|---:|---:|---:|
| ruby before | 7614ms | 1870ms | 73.50ms | 417ms | 30 |
| **ruby after** | **772ms** | **1534ms** | 73.07ms | 440ms | 30 |
| java before | 216ms | 287ms | 32.38ms | 249ms | 133 |
| **java after** | 167ms | **210ms** | **20.84ms** | **131ms** | **234** |
| kotlin | 207ms | 422ms | 28.49ms | 115ms | 149 |
| csharp | 527ms | 211ms | 3.98ms | 23ms | 792 |

Two of those rows need a caveat, and both cut against the numbers rather than
for them.

**C# reads unchanged here because this harness runs under bun.** Its win is
removing a `Response` per asset, and bun's `Response` is native, so bun never
paid the cost being removed. Under plain Node — which is what the package
targets — boot went 383ms to 300ms, measured interleaved over three runs.
Whenever a change touches how bytes reach a runtime rather than how a formatter
works, measure it on Node before believing this table.

**V8 is about 1.5x faster than JavaScriptCore on the Java and Kotlin modules**,
so those two rows understate what a Node consumer gets.

Ruby's first format is still over a second, and that is real rather than noise:
a one-off RuboCop config merge lands on the first call rather than on the boot.
It is the obvious next thing to move.

Kotlin was profiled and left alone: 47% of a format is
`LazyParseableElement::ensureParsed`, which is the Kotlin compiler's PSI parsing
a file three to five times, and that is upstream's design rather than something
redundant to remove.

## Against the reference tools

Wall clock to format N files, start-up included on both sides. Above 1.0 means
this repo is faster.

| | N=1 | N=10 | whole corpus |
|:---|---:|---:|---:|
| java vs google-java-format | **1.80x** | **2.00x** | **1.17x** |
| kotlin vs ktfmt | **2.50x** | **1.74x** | 0.98x |
| csharp vs CSharpier, one-shot | 0.65x | 0.85x | **1.62x** |
| csharp vs CSharpier, warm | **2.68x** | 0.94x | **1.54x** |
| ruby vs syntax_tree + RuboCop | 0.47x | 0.55x | 0.35x |

The last column is 200 files everywhere except C#, which is 169.

Both JVM reference CLIs and native CSharpier spread their work over four cores;
every module here is single-threaded, so these are won or lost on one core
against four.

Kotlin's last column is quoted as a ratio near parity rather than a crossover
file count, because it moved between runs purely on machine load. Where exactly
it crosses is not a number this hardware can pin down.

Ruby is the one we do not win, and the gap is not overhead — at N=200 it is a
roughly 3x wasm execution tax on RuboCop's own analysis, 31 KB/s against 93.
Booting is no longer the problem; running Ruby on WebAssembly is.

## The detail

- [`ruby.md`](ruby.md) — boot attribution, the snapshot, and why the documented
  memory leak does not reproduce.
- [`java-kotlin.md`](java-kotlin.md) — the `StringWrapper` and regex findings,
  and the two changes that measured too small to keep.
- [`csharp.md`](csharp.md) — the boot attribution and the native comparison.

Each records what did *not* work as well as what did. That half is worth more
per line: it is what stops the next person spending a day on `optimizationLevel=FULL`
or an instruction-sequence cache.
