---
---

Add a benchmark harness (`bun run bench`) that reports boot cost and
steady-state formatting cost separately, each package in its own process, over
real corpora fetched from the same upstream projects the conformance tests use.
The two costs trade against each other, so measuring either one alone hides what
a change did to the other. `bench/README.md` records where every package stands
and how each compares to its reference tool.
