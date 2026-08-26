# `@scalar/ruby-fmt` performance

Everything below was measured on this machine (4 shared vCPUs, 15 GB RAM, bun
1.3.11, Node v22.22.2) against `bench/corpus/ruby` — 200 files, 778 KB, of
RuboCop's own sources. The machine was shared with two other agents throughout,
so wall-clock numbers drift by a factor of two or more between runs; every
comparison here is either a matched pair run back to back, or an interleaved
per-file A/B, for that reason. Where a single number is quoted it is the median
of at least two runs at a load average under 4.

## 1. Where the 7.6 s boot went

Split by evaluating each boot phase separately against the shipped artifact:

| phase | cost | share |
|:---|---:|---:|
| read `ruby_fmt.wasm.br` from disk | 4 ms | 0.1% |
| brotli decompress (5.4 MB → 39.2 MB) | 160 ms | 1.7% |
| `WebAssembly.compile` | 210 ms | 2.3% |
| `RubyVM.instantiateModule` (CRuby startup) | 450 ms | 4.9% |
| `require "rubygems"` + `/bundle/setup` | 700 ms | 7.6% |
| `require "syntax_tree"` + patches | 860 ms | 9.4% |
| gemspec prelude (`RUBOCOP_SETUP` head) | 170 ms | 1.9% |
| **`require "rubocop"`** | **~6 700 ms** | **73%** |
| `ScalarRubyFmt.setup` (cop registry) | 130 ms | 1.4% |

So: **73% of boot was one `require`.** The architecture doc's "~4 s" was an
underestimate for the current artifact — after the Ruby 4.0 / RuboCop 1.81.6 bump
it is eight to ten seconds under load, six to seven at rest.

Breaking that require down further, by re-evaluating `rubocop.rb` under its own
path with each `require_relative` timed (proportions, since the instrumented run
is slower overall):

| group | share of the require |
|:---|---:|
| `rubocop/cop/style/*` (282 files) | 25% |
| `rubocop-ast` (incl. prism translation) | 23% |
| `rubocop/cop/lint/*` (153 files) | 16% |
| `rubocop/*` core (61 files) | 11% |
| `rubocop/cop/mixin/*` (78 files) | 6% |
| `rubocop/cop/layout/*` (100 files) | 4% |
| everything else | 15% |

And splitting *that* into parse versus execute: compiling all 891 RuboCop `.rb`
files with `RubyVM::InstructionSequence.compile` costs 3 688 ms, while loading
the same iseqs back with `load_from_binary` costs 847 ms. Roughly a third of the
require is CRuby parsing Ruby text; the rest is executing 588 cop class bodies.

The first `format` carried another ~900 ms of one-off cost:
`RuboCop::ConfigLoader.configuration_from_file` merging our config over
`default.yml`.

## 2. What changed

### 2.1 Boot snapshot (`packages/ruby/ruby_fmt.snapshot.br`)

None of the require work depends on the process it happens in, so it is now done
once at build time and shipped as an image of the resulting linear memory.
`build/ruby_fmt/write-snapshot.ts` boots a VM, diffs its memory against a bare
instance (module instantiated, `_initialize` **not** run — that baseline is
deterministic, whereas a booted VM's memory is not, because CRuby seeds hashes
from entropy at startup), and writes the changed 64 KB pages. Booting becomes
instantiate → `memory.grow` → blit.

This is Wizer's technique applied from JavaScript rather than to the wasm. It was
done that way deliberately: the artifact stays exactly the CRuby that ruby.wasm
builds, and the snapshot is a layer over it that is allowed to be absent.

Why a memory image is sufficient state was checked rather than assumed. The
artifact declares three mutable globals (`__stack_pointer` at 16 MB and two
asyncify flags at 0), all of which are at their initial values between calls —
which is when the snapshot is taken — and none of which are exported. Its single
element segment is static. The one piece of state outside linear memory is the
guest filesystem, which is a JavaScript `Map` on our side, so the snapshot
carries `/work` (18 files — the gemspecs `RUBOCOP_SETUP` writes) too.

The image also has the default RuboCop config pre-parsed and one warm-up format
already run, which is why `format.ts` now reserves a fixed filename
(`rubocop-default.yml`) for the default config: the guest caches a parsed config
by path, and a numbered name handed out in call order would let a caller's first
`rubocopConfig` claim the name the snapshot's cache entry sits under.

| | before | after |
|:---|---:|---:|
| `bun run bench ruby` boot | 9 177 / 11 458 / 18 698 ms | **695 / 710 / 755 ms** |
| first format | 1 466 – 2 165 ms | 1 509 – 3 305 ms |
| median format | 73.1 – 87.9 ms | 69.6 – 77.2 ms |
| mean format | 130.9 – 158.7 ms | 123.0 – 128.7 ms |
| KB/s | 25 – 30 | 30 – 32 |
| package on disk | 5.4 MB | 13.4 MB |

Boot is **10–13× faster**. The first format is unchanged within noise — the
spread on both sides is dominated by wasm tier-up and by whether the corpus's
44 KB first file lands during a busy moment.

The 8 MB the snapshot adds to the install is the real cost of this change, and it
is unconditional for Node consumers. In the browser it is opt-out
(`init({ snapshot: false })`).

### 2.2 Recycle on growth, not on an absolute ceiling

`format.ts` recycled the VM once linear memory passed an absolute 400 MB. A
booted VM on this artifact holds **378 MB** — CRuby reserves 342 MB of that
during startup, before a line of our Ruby runs — so the ceiling left about 20 MB
of headroom. Measured: one 38 KB file takes the VM to 400 162 816 bytes, i.e.
over the line, after which **every subsequent `format` triggered a full
recycle**. That is a ~9 s stall per file without a snapshot and ~0.75 s with one.

It was latent rather than visible only because the benchmark corpus is made of
small files and topped out at 394 MB — 6 MB short.

The threshold is now 300 MB of growth *past whatever booting left behind*, which
preserves the original intent (bound what formatting adds, keep the recycle's
transient double-buffer near 1 GB) without depending on what booting costs.
`SYNC_MEMORY_LIMIT_BYTES` became `SYNC_MEMORY_GROWTH_LIMIT_BYTES` the same way.

### 2.3 The documented leak does not reproduce

`README.md` and `.claude/architecture.md` both described formatting as leaking
"~74 MB per 23 KB of input", with a practical ceiling of ~680 KB per process.
That is no longer true of this artifact. Measured two ways:

- 200 real corpus files (778 KB, RuboCop pass on): 374 MB after boot → 393 MB
  after the *first* file → 393 MB after all 200. Flat.
- Eight passes of the 38 KB synthetic sample `vm-recycle.test.ts` uses, with
  `rubocop: false` (the shape the leak was characterised on): 378 MB → 400 → 408
  → 409 → 409 → 409 → 411 → 411 → 411 MB. It plateaus.

Ruby's own heap grows as expected and `GC.start` reclaims it. What is left is
CRuby's malloc arena settling, not an unbounded leak. My guess is that the Ruby
4.0 bump in `f316f85` fixed it and moved the cost into a large fixed startup
reservation instead — 342 MB at instantiate, where the old test comments talk
about a "64 MB boot".

I did **not** remove the recycling. It is a cheap safety net against a wall that
still exists, the test that guards it asserts a bound rather than the leak, and
one artifact's behaviour is not enough evidence to delete a crash guard. The
docs now describe what it actually does.

### 2.4 Cheaper output validity check

The formatter parses its own output before returning it, to catch syntax_tree
emitting Ruby that Ruby cannot read. That was `Ripper.sexp(out).nil?`, which runs
the parser *and* builds a full S-expression tree that nothing reads.
`Ripper.new(out).parse` + `error?` runs the same parser and answers the same
question. Measured inside the guest across the corpus: **3.16 ms → 1.83 ms per
file**, about 1.7% of a format. Real, but below the noise floor of the bench
harness — the median-format numbers above do not separate it from zero.

## 3. Against the native tools

`stree write` + `rubocop -a --only Layout --cache false` (syntax_tree 6.3.0,
RuboCop 1.81.6, native Ruby 3.3.6) against `node format-many.ts`, both formatting
the same N files in place in one fresh process, median of three runs:

| N | native | before | after | after ÷ native |
|---:|---:|---:|---:|---:|
| 1 | 1.51 s | 7.84 s | **3.24 s** | 2.1× |
| 10 | 2.07 s | 7.41 s | **3.75 s** | 1.8× |
| 200 | 8.66 s | 28.57 s | **24.76 s** | 2.9× |

(An earlier matched set at lower load: native 1.45 / 1.79 / 8.36 s, after 2.66 /
2.91 / 23.25 s.)

We do not beat the native tools, and the shape of the gap says why. At N = 1 the
gap is now 1.7 s, most of which is our boot plus first-format tier-up against
native Ruby's own ~1.4 s of `require`. At N = 200 the gap is per-file throughput:
93 KB/s native versus 31 KB/s here, a **3× wasm tax** on the same Ruby doing the
same work. Before this change the same table read 5.2× / 4.0× / 3.4×.

## 4. Conformance

Output is unchanged. Evidence, all run against the final state of the branch:

- `packages/ruby/test/native-conformance.test.ts` — **ran, passed** (native
  syntax_tree 6.3.0 present, matching the Gemfile pin; the test skips when it is
  not, so it was checked that it did not skip).
- `packages/ruby/test/rubocop-conformance.test.ts` — **ran, passed** (RuboCop
  1.81.6 / rubocop-ast 1.50.0 / parser 3.3.12.0, byte-identical against the real
  `RuboCop::CLI`).
- `packages/ruby/test/snapshot-equivalence.test.ts` — new. Boots one formatter
  from the image and one through the requires and asserts identical bytes,
  including a caller `rubocopConfig` the snapshot never saw and the
  `rubocop: false` path.
- **Whole benchmark corpus, both ways**: 200 files formatted through a
  snapshot-booted VM and a requires-booted VM, SHA-256 compared. `compared 200
  files, 0 differ, 0 rejected by both`. Run twice — once after the snapshot
  landed, once after the `Ripper` change.
- `bun run test` — all 7 packages pass (ruby: 64 tests).
- `bun run test:node` — 18 pass, 3 skip; Ruby formats under plain Node from
  `dist`, in 883 ms including boot.
- `bun run test:browser` — all 7 browser cases pass in real Chromium, Ruby cold
  at ~1.2 s, including the uncompressed-artifact-via-`init` case.
- `bun run types:check`, `bun run lint`, `bun run format` — clean (the three
  remaining lint warnings are pre-existing, in `packages/rust`).

## 5. What did not work

**Trimming RuboCop's requires.** `rubocop.rb` requires 778 files, 494 of which
are cop classes in departments the Layout pass never uses. Pushing their absolute
paths onto `$LOADED_FEATURES` before `require "rubocop"` does make Ruby skip them
— the registry drops from 588 cops to 110 — but it saved only ~1.7 s of ~10 s,
and it is fragile: `cop/mixin/method_complexity.rb` reaches for
`Metrics::Utils::RepeatedCsendDiscount`, and `metrics/utils/abc_size_calculator.rb`
reaches for `Metrics::CyclomaticComplexity`, so the skip list needs
hand-maintained exceptions that a RuboCop bump would silently invalidate. The
snapshot subsumes it completely, so it was abandoned.

**A precompiled instruction-sequence cache.** `to_binary` /`load_from_binary` is
4.3× faster than compiling from source (847 ms versus 3 688 ms for all of
RuboCop), so a bootsnap-style cache baked into the artifact would have saved
perhaps 3 s of the 10. It also needs a 3.7 MB payload, a monkeypatched `require`,
and regeneration in lockstep with the CRuby build. The snapshot saves all 10 s
for 8 MB and no monkeypatching, so this was not built.

**`wasm-opt -O3`.** The artifact is built with `-Os`. Re-running binaryen 123
with `-O3 --strip-debug --strip-producers` over the shipped artifact produced a
module 0.2 MB smaller and, in an interleaved per-file A/B over 120 corpus files
in one process, **3.8% slower** (15 528 ms versus 16 118 ms) with byte-identical
output. Re-optimising an already-optimised module is not the same experiment as
building with `-O3` from raw, but it is enough to say the easy version of this
buys nothing.

**Moving the per-format entry point into a Ruby method.** The current code evals
a ~400-character snippet per format, so Ruby parses and compiles it every time.
Defining `ScalarRubyFmt.run(path, width, config)` once and calling it made no
measurable difference — interleaved three-way A/B over the corpus came back
within 1.2%, which is the noise floor. Not worth the churn.

**Switching RuboCop's parser engine.** Already on prism
(`ProcessedSource#parser_engine` reports `parser_prism`), so there was nothing to
switch.

**GC tuning.** `GC.stat[:time]` over a full corpus run is 1 910 ms of 32 410 ms —
**5.9%** of format time, 88 collections, 8 major. Even eliminating GC entirely
caps the win at 5.9%, realistically half that, in exchange for a larger heap and
a new interaction with the recycle threshold. Below the measurement noise on this
machine, so not shipped.

**Caching RuboCop's `Team` across correction-loop iterations.** Instrumenting the
loop showed it is not where the time is: over 200 files / 288 iterations, parse
5 408 ms, `Team.mobilize` **170 ms (0.8%)**, `investigate` 16 634 ms (75%),
checksum 21 ms. The registry cache already in `rubocop.ts` had removed that cost;
cops are re-instantiated per file in real RuboCop too, so caching them would be a
divergence for no gain.

## 6. The steady-state conclusion, stated plainly

Per-format cost was measured three ways and there is no waste on our side left to
remove:

| phase | share of a format |
|:---|---:|
| RuboCop pass | 82.1% |
| syntax_tree | 14.2% |
| output validity check | 2.2% → 1.3% |
| reading input through WASI | 0.1% |

…and inside the RuboCop pass, 75% is `Team#investigate` — the 100 Layout cops
walking the AST. That is RuboCop doing RuboCop's work. The package runs at 31
KB/s against native Ruby's 93 KB/s on the same corpus, so the remaining gap is a
3× wasm execution tax, not algorithmic overhead. Closing it needs a faster CRuby
build or a faster wasm engine, not a change to this package.

## 7. Not done here, and what it would be worth

- **A real `-O3` build of CRuby.** Changing `build.sh`'s `wasm-opt -Os` to `-O3`
  and rebuilding from source is the honest version of the experiment in §5. I did
  not run it: `bun run ruby:build` downloads the wasi-sdk toolchain and compiles
  CRuby from source, ~20 minutes from cold on a quiet machine and realistically
  an hour on four vCPUs shared with two other agents, and a rebuilt artifact
  would need both conformance tests re-run against new bytes. Expected value:
  0–10% on steady state, from the inlining `-Os` declines. It would also cost
  install size.
- **Wizer proper.** ruby.wasm's toolchain supports Wizer pre-initialisation,
  which would fold the snapshot into the artifact and remove the 8 MB second
  file plus the ~250 ms decompress. Needs the same rebuild, and gives up the
  property that the artifact is stock ruby.wasm output. The JavaScript snapshot
  gets ~95% of the benefit with none of the toolchain risk, which is why it is
  what shipped.
- **Stripping Ruby source from the artifact.** With a snapshot, the `.rb` files
  for everything already required are dead weight in the wasm's 27 MB data
  section — except that RuboCop reads `config/default.yml` at runtime and
  backtraces read source. Worth maybe 2–3 MB off the artifact, needs a rebuild,
  and needs care to work out exactly what is still read.
- **Raising `MEMORY_GROWTH_LIMIT_BYTES`.** Now that a recycle costs 0.75 s rather
  than 9 s, and now that memory plateaus rather than leaking, the 300 MB
  allowance could probably be much larger or the recycle dropped to a
  crash-guard. I left it alone: `883f3d0` tuned this number against a real CI
  memory problem, and I have one machine's evidence that the leak is gone.
- **A native-comparison harness in the repo.** The §3 numbers came from a
  throwaway script. `scripts/bench/` would be the place for a permanent one, but
  adding tooling nobody asked for is scope creep, so it is not in the branch.

## Reproducing

```sh
bun install
bun run build
ln -s ../../bench bench          # or fetch it: bun run bench:corpus
bun run bench ruby

# boot the long way, for comparison
mv packages/ruby/ruby_fmt.snapshot.br /tmp/ && bun run bench ruby
mv /tmp/ruby_fmt.snapshot.br packages/ruby/

# rebuild the image after touching the boot sequence
bun run ruby:snapshot
```
