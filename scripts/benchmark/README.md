# Benchmarks

`bun run bench` measures every package against the native tool it is a compile
of, and writes the table in [`BENCHMARKS.md`](../../BENCHMARKS.md).

```sh
bun run build                 # the harness loads dist, not src
bun run bench                 # everything, both input sizes
bun run bench ruby php        # just these
bun run bench --size real --runs 20 --cold-runs 10 --batch 25
bun run bench --markdown BENCHMARKS.md --json bench.json
```

| flag | default | what it does |
| --- | --- | --- |
| `--size` | `both` | `small`, `real`, or `both` |
| `--runs` | `10` | timed formats per steady-state measurement |
| `--cold-runs` | `5` | process spawns per cold-start measurement |
| `--batch` | `10` | files per native invocation, for the marginal cost |
| `--json` | - | write every raw measurement here |
| `--markdown` | - | write the rendered report here |
| `--skip-native` | off | measure the packages only |
| `NODE=…` | `node` | the Node the packages run under |

## The two numbers

**Cold start** is one file in one process, with nothing warmed up: a pre-commit
hook, a one-shot CLI, a CI step that formats a single file. On our side that is
Node starting, reading and decompressing an artifact, and instantiating a
language runtime. On the native side it is process startup plus whatever the
tool loads - a JVM, a gem, a phar.

**Steady state** is one more file through a process that is already up: a
watcher, a language server, a run over a whole repository. The native side is
measured as the *marginal* cost of one more file inside a single invocation -
what a batch of 25 cost, minus what one file cost, over the 24 files that bought
- rather than a batch averaged over its file count, which would smear the tool's
own startup across the files and flatter it.

The gap between the two is the whole story for most of these packages, so the
report prints where the cold time goes as well: import, `init()`, the first
`format`, and a warmed-up one.

## What each target needs

A missing native tool does not fail the run: the row reports what is missing and
how to get it. Versions are held to the pins the artifacts were built from,
because a benchmark against a different release of the same tool is a benchmark
of a different program.

| target | native side | how to get it |
| --- | --- | --- |
| `ruby` | syntax_tree + RuboCop, both passes in one process | `gem install syntax_tree rubocop rubocop-ast parser` at the versions in `build/ruby_fmt/Gemfile[.lock]` |
| `ruby-syntax-tree` | syntax_tree alone, matching `{ rubocop: false }` | as above, syntax_tree only |
| `java` | `google-java-format` | on `PATH`, or the `-all-deps` jar in `build/java_fmt_teavm/toolchain` (`bun run java:build`) |
| `kotlin` | `ktfmt` | `bun run kotlin:build`, or `KTFMT_JAR=…` pointing at a jar with its dependencies |
| `csharp` | `csharpier` | `dotnet tool install -g csharpier --version <the pin in build/csharp_fmt/build.sh>` |
| `php` | the phar the package ships, on a native PHP | any `php` with the Phar extension |
| `rust` | `rustfmt` | `rustup component add rustfmt`, or `RUSTFMT=…`. Reported even when it is not the pinned build, because speed moves far less between releases than output does |
| `swift` | `swift-format` | ships with a Swift 6 toolchain |

## Where the samples come from

`samples/small` is a snippet of a dozen lines, where startup is nearly all of
the cost. `samples/real` is around 150 lines of ordinary application code - an
HTTP client with retries, pagination and a cache - which is closer to what files
in a repository actually look like. Both are the same program in seven
languages, so the sizes are comparable across rows.

They are inputs, never scratch: the harness copies them before anything formats
in place.

## What this does not measure

Whether the output matches. That is what the conformance tests assert, one per
package, against the real tool. The harness only checks that both sides produced
something, so a formatter that quietly gave up cannot post a good time.
