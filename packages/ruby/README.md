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

Async because the first call decompresses the artifact, compiles it, boots a
Ruby VM and loads RuboCop — about 5s all in. That work is cached, so every later
call is milliseconds. `format(source, { rubocop: false })` skips the RuboCop
half of it entirely: ~1.1s to boot, ~4ms a call.

---

## Two tools, and why both

`format` runs syntax_tree and then the real
[RuboCop](https://github.com/rubocop/rubocop), and neither is optional-by-accident:
they do different jobs and neither subsumes the other.

**syntax_tree reprints.** It throws away the input's line breaking and decides
it again from the syntax tree, which is what makes formatting idempotent and
input-independent.

**RuboCop does not.** It corrects offenses inside whatever line structure it is
handed. Measured on 116 files whose formatting differed only in line breaking —
the same code rendered two ways — RuboCop alone mapped **0 of them** to a common
result. syntax_tree mapped 91. On generator output it leaves this:

```ruby
class Client
  def initialize(base_url:, token: nil); @base_url = base_url; @token = token; end
end
```

Zero Layout offenses, by RuboCop's own reckoning. "One statement per line" is
not a Layout rule; it is a consequence of reprinting.

**But syntax_tree's output is not clean.** Over 397 files of real Ruby, about
30% of it still trips stock `rubocop --only Layout` — overwhelmingly
`Layout/MultilineOperationIndentation`, `Layout/MultilineMethodCallIndentation`
and `Layout/FirstArgumentIndentation`, where the two tools genuinely disagree
about how a wrapped expression should be indented. Formatted output that a
consumer's CI then rejects is not finished output.

So both run, in that order. The RuboCop half is exactly
`rubocop --autocorrect --only Layout`. Layout only — RuboCop's other departments
rewrite code rather than lay it out, and `-A` will happily delete an unused
assignment or turn an `if` into a ternary, which is not something a function
called `format` should do.

### Who owns what

syntax_tree owns line width, so `printWidth` means what it says. RuboCop's
`Layout/LineLength` is **off** in the config this package writes — it has to be,
because the two would otherwise disagree: with the cop at its default `Max: 120`,
`{ printWidth: 200 }` came back rewrapped at 124, which is neither width.
Turning it off costs nothing measurable. Over 397 files at the default width it
changes none of them, and the 9 files with a line over 120 have one either way,
because that cop's autocorrect could not fix them regardless.

RuboCop owns the rest of layout — indentation, alignment, blank lines, spacing.

### Configuring RuboCop

```js
await format(source, { rubocopConfig: { 'Layout/IndentationWidth': { Width: 4 } } })
```

Merged over the two entries this package sets, one level deep, and written into
the guest as the `.rubocop.yml` RuboCop loads. Anything a `.rubocop.yml` can say
belongs here, spelled exactly as that file spells it — including
`{ 'Layout/LineLength': { Max: 100 } }` to put that cop back and let RuboCop
have line width after all.

### Turning RuboCop off

```js
await format(source, { rubocop: false })
```

syntax_tree on its own, and none of what RuboCop costs — it is never even
loaded. Worth it if the output is not going anywhere near a RuboCop, or if the
[costs below](#what-it-costs) are not worth paying.

For `formatSync`, say it at `init` as well — `await init({ rubocop: false })`.
`formatSync` requires `init`, so that is the only way a synchronous caller can
leave RuboCop unloaded rather than merely unused.

The order is fixed, and it is the only order that works. The two tools disagree,
so whichever runs last decides. Running syntax_tree second would undo RuboCop's
corrections — over those same 397 files, in 116 of them.

### What it costs

| | `rubocop: false` | default |
|:---|:---|:---|
| first call into a VM | ~1.1 s, to boot the VM | plus ~4 s, to load RuboCop |
| every call after | ~4 ms | 2–3× that |
| artifact | 5.1 MB either way | |

The four seconds are RuboCop's 698 cop files being read and evaluated by a Ruby
that is itself running on WebAssembly. Nothing here can make that cheaper, so it
is spent only when it will be used: a caller who passes `rubocop: false`
everywhere and never calls `init` never loads RuboCop at all.

Both costs are per VM, so they are paid again after a
[recycle](#known-bug-the-vm-leaks-and-recycles-itself-to-survive-it) — worth
knowing if you are formatting a whole codebase in one process. The multipliers
are the part worth trusting; the absolute figures come from one machine,
measured in the same run as the syntax_tree ones beside them.

`init` loads RuboCop as well as booting the VM, so `formatSync` gets the default
pass without a first-call stall. That is the one reason to prefer `init` over
letting `format` boot on its own — and `init({ rubocop: false })` is how a
synchronous caller declines it.

The artifact carries both tools whichever way you call it — syntax_tree and
prettier_print are 141 KB of the 5.1 MB, so there was never a lighter build to
be had by dropping one.

### When it gives up

Corrections can introduce offenses, so RuboCop corrects in a loop until the
source stops changing. Two cops can also undo one another forever. When that
happens — a repeated checksum, or 200 rounds without settling, both RuboCop's
own conditions — `format` rejects rather than returning half-corrected source.

---

## Formatting without awaiting

`formatSync` is for callers with no `await` to give — a code generator that
formats each file inside the synchronous builder that emits it, a template
renderer, a plugin hook that has to return a string.

```js
import { formatSync, init } from '@scalar/ruby-fmt'

await init()
const formatted = formatSync(source)
```

Booting is the one thing that cannot be made synchronous, so `init` covers it
once — the VM *and* RuboCop — and `formatSync` throws until it has. Everything after that already was
synchronous — `format` was only ever awaiting the boot, and both produce the
same bytes.

Ruby is the one package with a caveat here. Formatting leaks the VM's linear
memory and only a recycle reclaims it, and recycling is asynchronous — so a long
synchronous run eventually has to come up for air. `formatSync` says so when it
happens; `await init()` again and carry on. The limit it refuses at is set well
above the one `format` recycles at, precisely so those pauses are rare.

Prefer `format` where you can await: it needs no setup call and cannot throw that
error.

## It runs in the browser too

The import does not change — bundlers and browsers pick the `browser` export
condition on their own, and `format` has the same signature and returns the same
bytes. Only the wasm's route in differs: fetched rather than read from disk.

```js
import { format, init } from '@scalar/ruby-fmt'

// Optional. The artifact resolves next to the module by default, which Vite,
// Rollup, webpack and a plain CDN handle unaided. esbuild does not rewrite
// `new URL(..., import.meta.url)`, so there it needs naming.
await init({ url: '/assets/ruby_fmt.wasm.br' })

await format(source)
```

Run it in a worker. Booting compiles 35.7 MB of wasm, which is a visibly frozen
tab if it happens on the main thread — and `rubocop: true` adds several seconds
of Ruby on top of that the first time it is asked for.

Formatting grows the VM's linear memory until it is recycled at 400 MB — a
ceiling picked for a Node process. A tab has less room to absorb that, so keep
large files off the main thread.

The browser reads the same brotli artifact as Node (5.1 MB over the wire) and
expands it with `DecompressionStream('brotli')` where the engine has it, or a
208 KB wasm decoder where it does not — Chrome, today. Serving the artifact with
`Content-Encoding: br`, or serving an uncompressed `.wasm`, skips the decoder
entirely:

```js
await init({ url: '/assets/ruby_fmt.wasm', encoding: 'none' })
```

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
| `options.rubocop` | `boolean` | `true` | Run `rubocop --autocorrect --only Layout` over the result. `false` for syntax_tree alone. [See above](#two-tools-and-why-both). |
| `options.rubocopConfig` | `Record<string, unknown>` | `{}` | Extra `.rubocop.yml` entries, merged over the ones this package sets — `{ 'Layout/IndentationWidth': { Width: 4 } }`. Ignored when `rubocop` is `false`. |

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

## These are the real gems, and the output is exact

There is no approximation here. This runs **actual
CRuby 3.4.1 compiled to WebAssembly** ([ruby.wasm](https://github.com/ruby/ruby.wasm))
with the **actual [syntax_tree](https://github.com/ruby-syntax-tree/syntax_tree)
gem** — and, for the RuboCop pass, the **actual
[RuboCop](https://github.com/rubocop/rubocop) gem** — baked into it. Neither is
a reimplementation, so neither drifts.

Two conformance tests assert byte-identical output against the same gems running
on a native Ruby, and both *assert* rather than report: any divergence is a real
bug, not a known stylistic gap.

- `test/native-conformance.test.ts` compares syntax_tree.
- `test/rubocop-conformance.test.ts` compares the Layout pass against
  `RuboCop::CLI` — the real command-line entry point, with both gem versions
  pinned at activation, because RuboCop's Layout output is not stable across
  releases and a machine with several installed resolves the bare `rubocop`
  binstub to the newest one.

It works because all of it is pure Ruby with no native extensions of its own.
syntax_tree and prettier_print need Ripper, RuboCop's parser needs racc, and
both are part of CRuby.

The versions are pinned in `build/ruby_fmt/Gemfile`, which is also where the
conformance tests read them from, so the native side and the wasm side cannot
drift apart. `rubocop-ast` is pinned alongside `rubocop` rather than left to
resolve: it decides which parser produces the token stream the Layout cops see,
so a newer one changes the output without RuboCop itself changing at all.

---

## What is not stock: three fixes for `case`/`in`

syntax_tree 6.3.0 has a family of bugs in pattern matching, and they all end the
same way — source that parsed on the way in comes back out as source Ruby cannot
read, or, in one case, as Ruby that parses and means something else. `format()`
re-parses everything it returns and raises rather than handing back a broken
file, so what these cost a consumer today is a formatter that refuses whole
files. `src/stree-patch.ts` carries the fixes, applied by reopening the classes
at boot: the artifact stays stock syntax_tree 6.3.0, and retiring a fix once it
lands upstream is deleting a constant.

### 1. A pattern that *ends* in an endless range

`then` is mandatory in a `case`/`in` clause whose pattern ends in an endless
range. Leave it out and Ruby reads the newline as the range's continuation and
swallows the following line into the pattern. syntax_tree knows this, but asks
whether the pattern *is* an endless range rather than whether it *ends* with one
— so it keeps `then` for `in 400..` and drops it everywhere else:

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
to `in status: 400..` and exposes the trailing `..`.

The fix decides on the *rendered* pattern rather than on its node types: format
the pattern on its own, and add `then` when what comes out ends in `..`. That
cannot be fooled by `in { m: "ends.." }`, and it does not need a list of node
types kept in step with the language.

### 2. A guarded clause loses the parentheses that make it legal

A guard sits exactly where `then` would go, so the fix above cannot help —
`in 400.. then if g` is not Ruby. The parentheses the author wrote are the only
legal spelling, and syntax_tree drops them: the clause reaches the formatter as
an `IfNode` wrapping the pattern, with nothing recording that they were ever
there.

```ruby
# in, and valid
case status
in (400..) if retryable
  retry_request
end

# out of stock syntax_tree 6.3.0 — "unexpected 'if', expecting 'then'"
case status
in 400 ..  if retryable
  retry_request
end
```

Writing `then` defensively in the input does not survive either, because that
`then` is not in the tree. So a guarded clause whose pattern does not terminate
itself gets the pattern wrapped back in a `Paren` node before it is formatted.
Going through a real node rather than printing brackets is what makes the
awkward cases come out right: `in {x: (500..)} if g` becomes
`in ({ x: 500.. }) if g`, because a hash pattern inside parentheses has to keep
its braces — `in (x: 500..)` does not parse.

### 3. A stray `**` claimed by a hash pattern

Two independent defects that compound, both around the nameless `**` in a hash
pattern.

Ripper does not report that `**`, so syntax_tree recovers it from the token
stream — with an unbounded reverse search that never checks whether the token it
found is anywhere near the pattern. An exponent is an `Op` named `:**` that
nothing else consumes, so `retry_count**2` on line 350 is still sitting in the
list when line 510 is parsed, and the hash pattern there adopts it:

```ruby
x = n**2        # anywhere earlier in the file

# out of stock syntax_tree 6.3.0 — a ** that was never written
case response
in { status: 200, body: String, ** then }
  handle
end
```

And when a `**` really is there, the ` then` after it is printed by
`format_contents`, which runs *inside* the braces — `in { a: 1, ** then }`,
which Ruby rejects with "unexpected 'then', expecting '}'".

The search now has a floor: a `**` that belongs to this pattern is the last
thing in it, so it has to start after everything else the pattern is known to
contain — its constant, its keywords, and its opening brace. That also refuses a
pin expression's exponent (`in { a: ^(n**2), b: 2 }`), where the stray `**` is
inside the pattern rather than before it. And the ` then` is printed only in the
one rendering with no braces to close it, which is the unwrapped `in ** then`.

Worth knowing if you hit this in the wild: spacing the exponent as `n ** 2`
avoids the bug, but syntax_tree normalises that straight back to `n**2`, so it
returns on the next run. And `in {}` after an exponent is the quiet one — it
becomes `in **`, which parses, but `in {}` matches only an empty hash while
`in **` matches any hash at all.

### How narrow the divergence is

Measured rather than asserted: formatting the rubocop (1.74 and 1.81),
rubocop-ast, syntax_tree, parser and regexp_parser gems both ways — 2,076 files
— the patches change the output of none of them, and none of them starts
failing to format. They fire only where stock syntax_tree emits a syntax
error.

`test/native-conformance.test.ts` pins that in both directions: byte-identity
with native syntax_tree everywhere else, plus a test asserting that native
output for each of these shapes still fails to parse while ours does not. When
syntax_tree releases a fix, that test fails and the patch behind it comes out.

Separately, `format()` parses everything it returns and raises instead of
handing back source Ruby cannot read. It costs about 2.7ms on a 28ms format,
which is a good trade for never writing a broken file again.

---

## Careful with `rubocop -a` afterwards: `Style/MultilineInPatternThen`

This is not a bug in this package, but it can undo what this package does.

RuboCop's `Style/MultilineInPatternThen` removes the `then` from a multiline
`case`/`in` clause. For a pattern ending in an endless range that `then` is
mandatory, so the cop's autocorrect produces Ruby that does not parse:

```ruby
# in — valid, and what this package emits
case status
in 500.. then
  retry_request
end

# out of `rubocop -a` — the next line is swallowed into the range
case status
in 500..
  retry_request
end
```

The Layout pass this package runs never touches it: `Style` is a different
department, and the pass is `--only Layout`. But since 0.4.0 bundles RuboCop,
the two tools now ship together, and a consumer who runs a full `rubocop -a`
over the output afterwards can silently break their own code. If that is your
pipeline, exclude the cop:

```yaml
# .rubocop.yml
Style/MultilineInPatternThen:
  Enabled: false
```


---

## Source layout

One function per file, arrow functions throughout, and no classes — the Ruby VM
is a cached module-level value rather than an object you have to construct.

| File | Exports | Purpose |
|:---|:---|:---|
| `src/format.ts` | `format` | The public entry point: recycle if needed, validate options, write input, format. |
| `src/boot-vm.ts` | `bootVm`, `recycleVm` | Boots CRuby with syntax_tree required and patched, and caches the result. |
| `src/stree-patch.ts` | `STREE_PATCHES` | The fixes applied on top of the gem, and why each is safe. |
| `src/rubocop.ts` | `RUBOCOP_SETUP`, `RUBOCOP_CONFIG_YAML` | The Layout pass: how RuboCop is driven, and which of its parts are used. |
| `src/wasi-shims.ts` | `createShimDirectory` | Stand-ins for the two stdlib extensions wasip1 cannot provide. |
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
and packs down about 7×. Decompression happens once per process (~100 ms via
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
