---
---

bench: measure every package against the native tool it is a compile of

`bun run bench` runs each package and its reference tool over the same input and
prints the two numbers that matter separately: the cold start of one file in one
process, and the marginal cost of one more file once the process is up. The
native side is measured the same two ways - one CLI invocation per file, and the
difference a batch makes - so the comparison is like for like rather than a warm
`format()` call against a tool that had to boot a JVM first.

Nothing published changes. The harness lives in `scripts/benchmark`, the samples
it formats are the same program in seven languages, and `BENCHMARKS.md` holds a
run of it with the machine it was measured on.
