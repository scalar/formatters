---
'@scalar/php-fmt': minor
---

Add `formatSync()`, a synchronous entry point.

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
