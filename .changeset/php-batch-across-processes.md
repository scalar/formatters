---
'@scalar/php-fmt': minor
---

Spread a batch across several PHP instances, and give `format()` the array form

`format()` now takes an array as well as a string, matching `formatSync()`, and
both split the batch across PHP instances running in separate child processes.
Batching already paid the fixer's autoload once per batch rather than once per
file; the batch still ran on one instance, and PHP CS Fixer is sequential. On a
four-core machine 200 generated files went from 11.5s to 4.6s.

Splitting cannot change output — PHP CS Fixer never looks past the file in front
of it — and a test asserts the split batch is byte-identical to the unsplit one.
Results stay in input order, with a failed file an `Error` at its own position.

The instances are child processes rather than worker threads because that is what
parallelises: several PHP instances in one process barely beat one however many
cores are free (200 files: 13.8s across four threads against 22.0s on one), while
the same instances in separate processes scale nearly linearly.

The batch forms take a new `concurrency` option. Left alone it is chosen from the
batch size, the CPUs the process may use and the memory it may spend, capped at
four instances — each costs roughly 220MB, so filling a large machine by default
would be the wrong trade. The CPU and memory budgets come from the cgroup as well
as the host, so a container gets its own limits rather than the machine's:
`os.availableParallelism()` does not see a CPU quota, because a quota throttles a
process rather than confining it to fewer cores. Batches under eight files per
instance are not split at all, since a child costs about 400ms to start.

Nothing here can fail a batch. A child that cannot be spawned or dies costs the
parallelism for its share only — the calling process formats that share itself.
