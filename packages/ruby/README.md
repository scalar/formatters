# Scalar Ruby Formatter

[![Version](https://img.shields.io/npm/v/%40scalar%2Fruby-fmt)](https://www.npmjs.com/package/@scalar/ruby-fmt)
[![Downloads](https://img.shields.io/npm/dm/%40scalar%2Fruby-fmt)](https://www.npmjs.com/package/@scalar/ruby-fmt)
[![License](https://img.shields.io/npm/l/%40scalar%2Fruby-fmt)](https://www.npmjs.com/package/@scalar/ruby-fmt)
[![Discord](https://img.shields.io/discord/1135330207960678410?style=flat&color=5865F2)](https://discord.gg/scalar)

The real syntax_tree gem, on real CRuby compiled to WebAssembly, callable from TypeScript on plain Node.

---

Scalar is an open-source API platform for teams who want beautiful developer interfaces without vendor lock-in.

- **[API References](https://scalar.com/products/api-references/getting-started)** — Interactive API documentation from OpenAPI and AsyncAPI specs.
- **[Developer Docs](https://scalar.com/products/docs/getting-started)** — Write in Markdown/MDX, generate API references, sync with two-way Git.
- **[SDK Generator](https://scalar.com/products/sdk-generator/getting-started)** — Type-safe SDKs and CLIs in TypeScript, Python, Go, PHP, Java, and Ruby.
- **[API Client](https://scalar.com/products/api-client/getting-started)** — Open-source, offline-first Postman alternative built on OpenAPI.

20M+ monthly npm installs · 15,500+ GitHub stars · MIT licensed · [scalar.com](https://scalar.com)

---

No Ruby install, no gems, no postinstall download.

```bash
npm i @scalar/ruby-fmt
```

```ts
import { format } from '@scalar/ruby-fmt'

await format('class A\n  def initialize(b)\n@b=b\n  end\nend')
// class A
//   def initialize(b)
//     @b = b
//   end
// end
```

Async because the first call decompresses the artifact, compiles it and boots a
Ruby VM — about 1.1s. That work is cached, so every later call is ~4ms.

---

## API

The package is written in TypeScript and ships its own declarations, so these
types are generated from the source rather than maintained beside it.

### `format(source, options?): Promise<string>`

```ts
import { format, type FormatOptions } from '@scalar/ruby-fmt'

const options: FormatOptions = { printWidth: 100 }

const formatted: string = await format('foo(aaaaaaaaaa, bbbbbbbbbb, cccccccccc, dddddddddd)', options)
```

| Parameter | Type | Default | Notes |
|:---|:---|:---|:---|
| `source` | `string` | — | Ruby source. Invalid syntax rejects the promise. |
| `options.printWidth` | `number` | `80` | Maximum line width — syntax_tree's own default. Must be a positive integer. |

`printWidth` is validated rather than trusted, because it is interpolated into
the Ruby expression that drives the format. TypeScript stops nothing there: the
types are advisory to a JavaScript caller, and `{ printWidth: '80; system("…")' }`
is perfectly expressible in plain JS. A non-integer or non-positive value throws
a `TypeError` instead of reaching Ruby.

The wasm artifact is exported under its own subpath too, for anyone who wants to
instantiate it themselves:

```ts
const artifact = import.meta.resolve('@scalar/ruby-fmt/wasm')
// file:///…/node_modules/@scalar/ruby-fmt/ruby_fmt.wasm.br — still brotli-compressed
```

---

## This is the real syntax_tree, and the output is exact

There is no approximation here. This runs **actual
CRuby 3.4.1 compiled to WebAssembly** ([ruby.wasm](https://github.com/ruby/ruby.wasm))
with the **actual [syntax_tree](https://github.com/ruby-syntax-tree/syntax_tree)
gem** baked into it. It is not a reimplementation, so it does not drift.

`test/native-conformance.test.ts` asserts byte-identical output against the
same gem running on a native Ruby. That test *asserts* rather than reports: any
divergence is a real bug, not a known stylistic gap.

It works because syntax_tree and prettier_print are pure Ruby with no native
extensions. Their only C dependency is Ripper, which is built into CRuby.

---

## The one thing that is not stock: `case`/`in` with an endless range

`then` is mandatory in a `case`/`in` clause whose pattern ends in an endless
range. Leave it out and Ruby reads the newline as the range's continuation and
swallows the following line into the pattern. syntax_tree 6.3.0 knows this, but
asks whether the pattern *is* an endless range rather than whether it *ends*
with one — so it keeps `then` for `in 400..` and drops it everywhere else:

```ruby
# in, and valid
case status
in 300.. | 400.. then
  retry_request
end

# out of stock syntax_tree 6.3.0 — Ruby cannot parse this
case status
in 300.. | 400..
  retry_request
end
```

`in { status: 400.. } then` breaks the same way, because syntax_tree unwraps it
to `in status: 400..` and exposes the trailing `..`. Both come out of source
that parsed on the way in, and nothing raises — the first thing you learn is
that a generated file no longer compiles.

`src/stree-patch.ts` fixes it by deciding on the *rendered* pattern rather than
on its node types: format the pattern on its own, and add `then` when what comes
out ends in `..`. That cannot be fooled by `in { m: "ends.." }`, and it does not
need a list of node types kept in step with the language. The patch is applied
by reopening the class at boot, so the artifact stays stock syntax_tree 6.3.0
and retiring the patch is deleting one file.

The divergence is deliberately narrow, and measured: formatting the rubocop,
rubocop-ast and syntax_tree gems both ways — 1,033 files — it changes the output
of none of them. `test/native-conformance.test.ts` pins it in both directions:
byte-identity with native syntax_tree everywhere else, plus one test asserting
that native output for this shape still fails to parse while ours does not. When
syntax_tree releases the fix, that test fails and the patch comes out.

Separately, `format()` parses everything it returns and raises instead of
handing back source Ruby cannot read. It costs about 2.7ms on a 28ms format,
which is a good trade for never writing a broken file again.

---

## Source layout

One function per file, arrow functions throughout, and no classes — the Ruby VM
is a cached module-level value rather than an object you have to construct.

| File | Exports | Purpose |
|:---|:---|:---|
| `src/format.ts` | `format` | The public entry point: recycle if needed, validate options, write input, format. |
| `src/boot-vm.ts` | `bootVm`, `recycleVm` | Boots CRuby with syntax_tree required and patched, and caches the result. |
| `src/stree-patch.ts` | `IN_PATTERN_THEN_PATCH` | The one fix applied on top of the gem, and why it is safe. |
| `src/compile-artifact.ts` | `compileArtifact` | Locates, decompresses and compiles `ruby_fmt.wasm.br`, at most once per process. |
| `src/types.ts` | `FormatOptions`, `RubyFormatterVm` | The two types the other files share. |

`bun run build` compiles `src/` to `dist/`, which is what the published package
exports. `dist/` is gitignored, so a fresh clone builds before it packs — the
`prepack` check fails the pack if it has not.

---

## One artifact, and how to get it

The package ships a single `ruby_fmt.wasm.br` containing CRuby and the gems.
There is no directory to mount at boot and nothing to resolve at runtime.

It is stored brotli-compressed, because the artifact is mostly Ruby source text
and packs down about 5×. Decompression happens once per process (~100 ms via
`node:zlib`, no dependency added), not once per format — the compiled
`WebAssembly.Module` is cached, so even recycling the VM after the memory leak
reuses it.

Two things keep it small. Everything the formatter never loads is stripped
before packaging: `rdoc`, `bundler`, `prism`, `irb`, `reline`, and the bundled
gem tree (`rake`, `minitest`, `rexml`, `net-imap`, `typeprof`…). That list is not
guesswork — it is the complement of `$LOADED_FEATURES` after a real format, which
touches just 72 files. `rubygems` stays, because Ruby loads it during startup,
and so does `specifications/`, which backs the default gems that do load. Then
`wasm-opt -Os` runs over what remains.

Note that `rbwasm --without-stdlib` cannot do any of this: it accepts only `enc`,
and that is a no-op for a static build, which compiles the encodings in.

That artifact is committed, so a fresh clone runs the tests with nothing extra.
Rebuild it only when the Ruby version or the pinned gems change:

```bash
bun run ruby:build    # ~20 min from cold, needs Ruby + bundler
```

`build/ruby_fmt/Gemfile.lock` is committed alongside it, so the versions that
produced the checked-in bytes are recoverable rather than whatever resolves
today.

---

## Known bug: the VM leaks, and recycles itself to survive it

Formatting grows the VM's wasm linear memory by roughly **74MB per 23KB of
input**, and never releases it. It is not Ruby-level garbage — the object heap
stays flat at ~65k live slots and `GC.start` does not help — so nothing inside
the VM can reclaim it.

Left alone, the VM hits the wasm32 2GB signed-pointer boundary after about
**680KB of cumulative input**, at which point a guest pointer read as a signed
i32 goes negative and the glue throws `RangeError: Start offset -… is outside
the bounds of the buffer`. Every individual file formats fine; only a process
that formats *many* files dies — which is exactly what formatting a whole
codebase does.

`format()` therefore watches the VM's memory and rebuilds it before the wall.
Recycling reuses the cached `WebAssembly.Module`, so it costs the VM boot alone —
not another decompress and compile. `test/vm-recycle.test.ts` keeps that honest
by asserting the bound rather than the crash: it formats past the ceiling
repeatedly and fails if linear memory ever climbs beyond 800MB, which is what
happens the moment recycling stops.

The rebuild threshold is **400MB**, far below the 2GB wall it is protecting
against. That is deliberate: a recycle cannot release the outgoing VM's linear
memory synchronously, so the process briefly holds the old buffer and the new
one together. Recycling at 1.1GB made that pair peak at ~1.5GB resident;
recycling at 400MB holds the peak near 1GB, for about one extra ~250ms boot per
130KB of input. Peak memory is the scarcer resource for anything formatting a
codebase in CI, so it is the one being spent down.

---

## Three implementation notes worth knowing

Each of these cost real debugging time, so they are recorded here.

**`node:wasi` is not usable for this**, even though the package only ever runs
on Node. `RubyVM.instantiateModule` wants a `{ wasiImport, initialize }` pair,
which Node's built-in WASI does provide — so it fits on paper. It does not fit
in practice: Node's WASI segfaults non-deterministically once ruby.wasm is given
preopened directories, and a preopen is how Ruby receives its input. Measured at
2 failures in 6 runs on identical input, and the process dies with SIGSEGV
rather than throwing anything catchable. This package uses
[`@bjorn3/browser_wasi_shim`](https://github.com/bjorn3/browser_wasi_shim)
instead, which is what ruby.wasm's own documentation uses. It is pure JavaScript
with no native build step, and its in-memory filesystem means the source being
formatted never touches disk.

**In the shim, `fds` is the entire file-descriptor table.** Indices 0, 1 and 2
must be stdin, stdout and stderr; preopened directories start at index 3.
Passing a `PreopenDirectory` as the first element does not raise — it silently
becomes stdin, and every path lookup then fails with `ENOENT`. Relatedly, the
shim's `debug.enable(undefined)` resolves to `true`, so `{ debug: false }` must
be passed explicitly or every syscall is traced to stdout.

**The build needs the `js` gem and the `full` profile.** Without `js` in the
Gemfile, rbwasm emits a standalone WASI command exporting only `_start`, which
`@ruby/wasm-wasi` cannot bind to — every format would pay a fresh VM boot. And
`--build-profile minimal` compiles no default extensions at all, so the artifact
gets as far as `require "syntax_tree"` before dying on `cannot load such file --
ripper`. There is no minimal-plus-ripper option.

---

## Input handling

Source is written directly into the guest filesystem, never interpolated into
Ruby code. Embedding it in a Ruby string literal would be unsafe: Ruby evaluates
`#{...}` inside double quotes and JSON escaping does not escape `#`, so any
snippet containing `#{}` would execute inside the VM. There are tests covering
both interpolation and a command-substitution attempt.

## Community

We are API nerds. You too? Let's chat on Discord: <https://discord.gg/scalar>

## License

MIT for this package's own source. The artifact embeds CRuby and the `logger`
gem (Ruby License / BSD-2-Clause), syntax_tree, prettier_print and the `js` gem
(MIT), and statically links wasi-libc (Apache-2.0-with-LLVM-exception / MIT).
All permissive; see [`licenses/NOTICE.md`](licenses/NOTICE.md).
