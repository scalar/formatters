---
'@scalar/ruby-fmt': patch
---

Comment-only change inside the package: `node-vm.ts` now records that the benchmark harness reads the same shared VM the formatter and the recycling test do. No behaviour change, and no change to formatted output.

The harness itself is repo tooling, `bun run ruby:bench`. It measures cold start split into artifact compile, VM boot and first format; the cost of one VM recycle, timed against a VM grown past the ceiling `format()` actually recycles at; and a whole-corpus run reporting format time, ms/KB and recycle count. Each measurement runs in its own process, because booting is once per process and formatting leaks the VM's linear memory, so anything measured second is measured against a VM the first thing already degraded.

Corpus runs can write a hash per formatted file, and `--compare` diffs two of those snapshots — which is how a rebuilt wasm artifact answers "the output did not change".
