# @scalar/php-fmt

## 0.4.0

### Minor Changes

- b744e6b: Spread a batch across several PHP instances, and give `format()` the array form

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

## 0.3.0

### Minor Changes

- 20631f9: Add batch support to `formatSync`, formatting an array of sources in one PHP CS
  Fixer invocation while returning per-source errors in place.

## 0.2.0

### Minor Changes

- efdd098: Add `formatSync()`, a synchronous entry point.

  Same fixer, same rules, byte-identical output to `format()` — asserted by a test
  rather than assumed. It exists for the seams that are synchronous and cannot be
  changed: a template renderer, a code generator's write hook, anything that has
  to return a string rather than a promise.

  PHP on wasm has no synchronous entry point and cannot be given one. The
  `asyncify` build unwinds and rewinds its stack through JavaScript, the `jspi`
  build wraps its entry in `WebAssembly.Suspending`, and the one export either
  offers returns a promise whatever the script does. So the synchrony comes from
  the thread: PHP runs in a worker and the caller parks on `Atomics.wait` until
  the result lands in shared memory. `worker_threads`, `SharedArrayBuffer` and
  `Atomics` are all Node built-ins, so this adds no dependency and needs no flags.

  The costs are real and worth reading before reaching for it: it blocks the
  calling thread for the ~300ms a format takes, the worker is a second PHP
  instance if the process also uses `format()`, and it resolves its worker file
  next to itself at runtime, so keep the package external if you bundle.
