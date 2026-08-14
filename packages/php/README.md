# Scalar PHP Formatter

[![Version](https://img.shields.io/npm/v/%40scalar%2Fphp-fmt)](https://www.npmjs.com/package/@scalar/php-fmt)
[![Downloads](https://img.shields.io/npm/dm/%40scalar%2Fphp-fmt)](https://www.npmjs.com/package/@scalar/php-fmt)
[![License](https://img.shields.io/npm/l/%40scalar%2Fphp-fmt)](https://www.npmjs.com/package/@scalar/php-fmt)
[![Discord](https://img.shields.io/discord/1135330207960678410?style=flat&color=5865F2)](https://discord.gg/scalar)

PHP formatter that runs on plain Node. No PHP install, no Composer, no `php` on `PATH`, no postinstall download.

---

Scalar is an open-source API platform for teams who want beautiful developer interfaces without vendor lock-in.

- **[API References](https://scalar.com/products/api-references/getting-started)** — Interactive API documentation from OpenAPI and AsyncAPI specs.
- **[Developer Docs](https://scalar.com/products/docs/getting-started)** — Write in Markdown/MDX, generate API references, sync with two-way Git.
- **[SDK Generator](https://scalar.com/products/sdk-generator/getting-started)** — Type-safe SDKs and CLIs in TypeScript, Python, Go, PHP, Java, and Ruby.
- **[API Client](https://scalar.com/products/api-client/getting-started)** — Open-source, offline-first Postman alternative built on OpenAPI.

20M+ monthly npm installs · 15,500+ GitHub stars · MIT licensed · [scalar.com](https://scalar.com)

---

```bash
npm i @scalar/php-fmt
```

```js
import { format } from '@scalar/php-fmt'

await format('<?php\nclass A{\npublic function b(){return 1;}\n}')
// <?php
//
// class A
// {
//     public function b()
//     {
//         return 1;
//     }
// }
```

Async because the first call decompresses the phar and boots PHP — about 0.5s.
That work is cached, so every later call is ~290ms.

Options are PHP CS Fixer `Config` settings, spelled the way a
`.php-cs-fixer.php` file spells them:

```js
await format(source, { rules: '@Symfony', indent: '  ' })
await format(source, { rules: { '@PSR12': true, array_syntax: { syntax: 'short' } } })
await format(source, { rules: 'declare_strict_types', riskyAllowed: true })
```

`rules` takes either a string — a comma-separated list of rule and rule set
names, read exactly as `--rules` reads it, with a leading `-` disabling one — or
the object `Config::setRules()` takes. It defaults to `@PSR12`, which is what
the tool falls back to when it finds no configuration file. `indent`,
`lineEnding` and `riskyAllowed` keep the tool's defaults when omitted.

## Formatting many files: pass the batch

Whenever you have the files together — a code generator's emitted output is the
case this exists for — hand over the array rather than calling once per file.

```js
const results = await format([source, otherSource, thirdSource])
// Array<string | Error>, in input order
```

Two things happen that a call per file cannot do. The fixer's autoload and
application setup run once for the whole batch instead of once per file, and the
batch is then split across several PHP instances in separate processes. Both
matter, and the second one matters more than the first: on a four-core machine,
200 generated files take 11.5s as one batch and 4.6s as a split one.

Results come back in input order. A file that could not be formatted is an
`Error` at its own position — `SyntaxError` for invalid PHP — while every other
file formats normally, so one bad file never costs you the batch.

Splitting is safe rather than approximate. PHP CS Fixer never looks past the file
in front of it, so which instance formats a file cannot change what it formats
to; a test asserts the split batch is byte-identical to the unsplit one.

```js
await format(sources, { concurrency: 8 })
```

`concurrency` is how many instances to use, and it is the one option here that is
not a PHP CS Fixer setting — it changes how fast the batch formats, never what it
formats to. Leave it alone and it is chosen for you from the batch size, the CPUs
this process may use and the memory it may spend, capped at four.

That budget is read from the cgroup as well as from the host, which matters in a
container: `os.availableParallelism()` reports the host's CPUs, and a CPU *quota*
— `docker run --cpus=2`, a Kubernetes `limits.cpu` — does not appear in it,
because a quota throttles a process rather than confining it to fewer cores.
A container given two CPUs and 1GB therefore gets a batch sized for two CPUs and
1GB rather than for the machine underneath it.

Each instance costs roughly 220MB resident, which is the reason the default stops
at four rather than filling the machine. If you know your own budget, say so.
`concurrency: 1` keeps everything in the calling process, exactly as it was
before splitting existed.

Nothing about this can fail the batch. A child process that cannot be spawned —
a sandbox that forbids it, a container out of memory — costs the parallelism for
its share and nothing else: the calling process formats that share itself, and
you get the same bytes a little slower.

## `formatSync()`, for callers that cannot await

```ts
import { formatSync } from '@scalar/php-fmt'

const formatted: string = formatSync('<?php $a=1;', { rules: '@Symfony' })
```

The array form works here too, and for the same reasons — one autoload for the
batch, then split across processes. Results stay in input order; a failed item is
an `Error` (`SyntaxError` for invalid PHP), while the other items still format
normally.

```ts
const results: Array<string | Error> = formatSync([
  '<?php $a=1;',
  '<?php class {{{',
  '<?php $b=2;',
])

// [formatted source, SyntaxError, formatted source]
```

Same fixer, same rules, byte-identical output — a test asserts that against
`format()` rather than trusting it. It exists for the seams that are
synchronous and cannot be changed: a template renderer, a code generator's
write hook, anything that has to return a string rather than a promise.

PHP on wasm has no synchronous entry point and cannot be given one. The
`asyncify` build unwinds and rewinds its stack through JavaScript, the `jspi`
build wraps its entry in `WebAssembly.Suspending`, and the single export either
one offers hands back a promise whatever the script does. So the synchrony comes
from the thread instead: PHP runs in a worker, and `formatSync` parks the
calling thread on `Atomics.wait` until the result lands in shared memory. Both
are Node built-ins, so this needs nothing installed and no flags.

What that costs, and it is worth knowing before you reach for it:

- **It blocks the calling thread**, which is the point, but it means nothing
  else on that thread runs for the ~300ms a format takes — no timers, no I/O
  callbacks, no rendering. The first call adds the ~500ms of booting PHP.
- **The worker is its own PHP instance.** Using `format` and `formatSync` in
  one process boots two, and they do not share the ~24MB each one costs. Prefer
  one or the other per process where that matters.
- **It resolves `sync-worker.js` next to itself at runtime.** That is fine for
  anything consuming the published files, but a bundler that inlines the package
  into a single file will leave the worker behind. Keep this package external if
  you bundle.

Prefer `format()` wherever you can await. This is for where you cannot.

## This is the real PHP CS Fixer, and the output is exact

This is **actual [PHP CS Fixer](https://github.com/PHP-CS-Fixer/PHP-CS-Fixer)
3.95.18** — the official phar, unmodified — running on **actual PHP 8.4**
compiled to WebAssembly. It is not a reimplementation, so it does not drift.

`test/native-conformance.test.ts` asserts byte-identical output against a native
`php` running **the same phar this package ships**, across promoted
constructor properties, enums, `match`, first-class callables, heredocs,
closures and control flow. Running the shipped artifact rather than a
`php-cs-fixer` found on `PATH` is deliberate: a PATH copy would be some other
version, and the version difference would surface as a formatting divergence
that has nothing to do with wasm. Same bytes, same rules, one variable — the PHP
underneath. That test *asserts* rather than reports: any divergence is a real
bug. It skips cleanly when no native `php` is around, so a PHP-free checkout
still passes.

Beyond those samples, the package was checked against 1117 real PHP files — PHP
CS Fixer's own sources plus the Symfony, ReactPHP and PSR components vendored
into its phar — formatted by both this package and a native `php`. All 1117 came
out byte-identical, and 1100 of them were files the fixer actually rewrote, so
that is a comparison of real output rather than of untouched input.

## Nothing is compiled here, and that is the point

The other packages in this repo compile their reference tool to wasm themselves,
because no wasm build of it exists. PHP CS Fixer needs no such step: it is pure
PHP, so the released phar *is* the tool, and the PHP to run it already exists as
a maintained wasm build. Compiling anything from source here would only
introduce a copy that could drift from the release.

So `build/php_fmt/build.sh` downloads the pinned phar, checks it really is one,
and brotli-compresses it — 3.5MB down to 0.44MB. The result is committed, so a
fresh clone needs nothing extra.

## `format()` runs the `fix` command, in-process

It drives PHP CS Fixer's own `Application` against the `fix` command — the same
entry point the `php-cs-fixer` executable reaches — rather than assembling a
`Runner` by hand. The pipeline around the fixers is part of what the tool is,
and `Runner`'s constructor changes between minor versions while the command's
does not.

It does that **in-process rather than by executing the phar**, because PHP's CLI
SAPI is one-shot: the first `cli()` call on a runtime works and every one after
it silently does nothing, leaving you with your own input back and a zero exit
code. Rotating to a fresh runtime per format works but triples the cost
(~900ms against ~290ms), and the embed SAPI this uses instead is reusable and
does not leak — memory is flat across formats, unlike the Ruby package's VM.

## Caveats worth knowing before you adopt it

**Configuration discovery is missing.** The tool walks up the filesystem looking
for a `.php-cs-fixer.php`. There is no filesystem here to walk, so if your
project has one, read it and pass its settings in as options. This is the same
gap the Swift package has, and for the same reason.

**It formats strings, not a project.** Even the batch API receives independent
source strings rather than a project tree. Rules that need configuration or
files outside that batch have nothing else to look at.

**Unparseable input throws.** PHP CS Fixer skips a file it cannot parse and
still exits zero, which would hand you your own input back and call it
formatted. This package checks the source with the same
`token_get_all($source, TOKEN_PARSE)` the tool's own linter uses and throws a
`SyntaxError` instead.

**Risky rules are opt-in, and asking for one without opting in is an error**
rather than a silent skip — again, a rule that quietly did not run is the
failure mode worth being loud about.

**~290ms per formatter invocation** is slow next to the other packages here,
and it is not the wasm: PHP CS Fixer autoloads several hundred classes on every
request, and that dominates. Fine for a file on save; for anything larger pass
the array so the batch pays that cost once and gets split across processes.

**Sharding a batch spends processes and memory.** Each instance is a forked
process holding its own PHP, about 220MB once the fixer's classes are loaded, so
the default concurrency of four peaks near 900MB. It is also why a small batch is
never split: a child costs about 400ms to start and boot PHP, so fewer than eight
files per instance would not repay it, and batches under eight files stay on the
instance the process already has.

**Subprocess functions are disabled inside the runtime,** and that is load-
bearing rather than hardening. `Config`'s constructor asks
fidry/cpu-core-counter how many CPUs there are, and most of its finders shell
out through `proc_open`. There are no subprocesses in wasm, so every attempt
failed and leaked the pipes it had opened — and `FixCommand` builds a `Config`
on every format, so after roughly 100 calls the guest ran out of file
descriptors and the runtime trapped. Disabling the functions makes the finders
fail before they open anything; core detection falls through to its own fallback
and reports one core, which is what a single-file format wants anyway.
`test/descriptor-leak.test.ts` holds that line at 150 consecutive formats.

**PHP itself is a dependency, not a bundled artifact.** The runtime comes from
`@php-wasm/node-8-4`, pinned — which is what pins the PHP the fixer runs on.
That package is deliberately *not* the `@php-wasm/node` meta-package it sits
under: that one pulls in prebuilt `.node` binaries and an install script, which
this repo exists to avoid, and every PHP version from 7.4 to 8.5, turning a 66MB
install into a 463MB one. Its file locking and WebSocket networking also keep
Node's event loop alive, so a process that formats a file and returns never
exits. The two packages used here have no install scripts and no native
binaries.

## Community

We are API nerds. You too? Let's chat on Discord: <https://discord.gg/scalar>

## License

MIT for this package's own source. The phar it ships is MIT except
`sebastian/diff`, which is BSD-3-Clause; see [`licenses/NOTICE.md`](licenses/NOTICE.md).
