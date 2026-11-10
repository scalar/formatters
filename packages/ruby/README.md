# Scalar Ruby Formatter

[![Version](https://img.shields.io/npm/v/%40scalar%2Fruby-fmt)](https://www.npmjs.com/package/@scalar/ruby-fmt)
[![Downloads](https://img.shields.io/npm/dm/%40scalar%2Fruby-fmt)](https://www.npmjs.com/package/@scalar/ruby-fmt)
[![License](https://img.shields.io/npm/l/%40scalar%2Fruby-fmt)](https://www.npmjs.com/package/@scalar/ruby-fmt)
[![Discord](https://img.shields.io/discord/1135330207960678410?style=flat&color=5865F2)](https://discord.gg/scalar)

The real syntax_tree gem on real CRuby, then RuboCop's Layout pass via [rbcop](https://github.com/costajohnt/rbcop), both compiled to WebAssembly and callable from TypeScript on plain Node.

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

Async because the first call decompresses the two artifacts, compiles them and
instantiates both — about half a second all in. That work is cached, so every
later call is milliseconds. The Ruby VM arrives with syntax_tree already loaded,
because its artifact is a snapshot of one that has already booted.

---

## Two tools, and why both

`format` runs syntax_tree and then RuboCop's Layout department, and neither is
optional-by-accident: they do different jobs and neither subsumes the other.

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
not a Layout rule; it is a consequence of reprinting. That is also why the Ruby
VM stays even though the RuboCop pass no longer needs one: nothing but
syntax_tree reprints, and syntax_tree needs CRuby.

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

### The RuboCop pass is rbcop

The pass is not the RuboCop gem. It is
[rbcop](https://github.com/costajohnt/rbcop): RuboCop 1.92.2 reimplemented in
Rust on Prism, built for byte-identical output, and compiled here to a second
wasm module of its own. It does the same Layout pass in about 4 ms a file,
against about 80 ms for the RuboCop gem on CRuby wasm, and it does not grow the
Ruby VM's memory.

That makes it the one part of this package that is a reimplementation, and a
reimplementation is exact only for as long as something keeps checking it.
[`test/rubocop-conformance.test.ts`](#the-output-is-exact-and-how-that-is-held)
does: it runs the real `rubocop` 1.92.2 binary over the same input and asserts
byte-identical output. Run over 300 files of real Ruby it found no divergence.
Run over a second corpus of 2,754 files it found one rbcop bug, on 10 of them:
`Layout/MultilineOperationIndentation` re-indented the wrapped operand of a
regex literal's `=~`, which RuboCop never looks at. The build fixes it (see
`build/rbcop_fmt/rbcop-wasm.patch`), the test now pins both shapes, and with the
fix both corpora match the real binary on every file.

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

Merged over the two entries this package sets, one level deep, and written as
the `.rubocop.yml` the pass loads. Anything a `.rubocop.yml` can say about
Layout cops belongs here, spelled exactly as that file spells it — including
`{ 'Layout/LineLength': { Max: 100 } }` to put that cop back and let RuboCop
have line width after all.

What it cannot do is run Ruby, because the pass has none. ERB in the config, a
remote `inherit_from` URL, `require:` and custom cops all need one, and each is
an error naming what was asked for rather than a config quietly read some other
way. A value of the wrong type — `{ Width: 'four' }` — fails where RuboCop's
own `TypeError` would, and the next format goes through as normal.

### Turning RuboCop off

```js
await format(source, { rubocop: false })
```

syntax_tree on its own. It skips the pass *and* the loading: the rbcop module is
a separate artifact, and a process (or a page) that never asks for the pass
never fetches or compiles it. `formatSync(source, { rubocop: false })` declines
exactly as much as `format` does. `init` takes no options at all under Node; the
browser build's take only the artifacts' locations.

The order is fixed, and it is the only order that works. The two tools disagree,
so whichever runs last decides. Running syntax_tree second would undo RuboCop's
corrections — over those same 397 files, in 116 of them.

### What it costs

Measured on one machine, over 300 files of real Ruby (1.2 MB), against the
release that ran the RuboCop gem inside the Ruby VM:

| | before | now |
|:---|---:|---:|
| first `format()` in a fresh process | ~0.86 s | **~0.5 s** |
| all 300 files, RuboCop on | 31.1 s | **7.5 s** |
| the RuboCop pass's share of that | 23.9 s | **1.2 s** |
| per file, RuboCop pass | ~80 ms | **~4 ms** |
| installed artifacts (brotli) | 13.9 MB | **7.9 MB** (5.7 + 2.2) |
| a fresh Ruby VM's linear memory | ~373 MB | **~332 MB** |

syntax_tree is now most of what a format costs, at ~25 ms for a typical file.
Per-call cost grows faster than file size, so a very large file is worse per KB
than that suggests. It used to be far worse again for a file carrying any
multi-byte character at all — one accented letter made syntax_tree's parser
quadratic in the file's size. The dominant term of that is
[gone](#4-the-comment-walk-that-is-quadratic-on-a-multi-byte-source). What
remains is superlinear in size, and still somewhat worse with a multi-byte
character than without.

The rbcop instance keeps every config it has resolved, so the first format with
a given `rubocopConfig` pays ~30 ms to merge it over RuboCop's `default.yml` and
every later one pays nothing for it.

### When it gives up

Corrections can introduce offenses, so RuboCop corrects in a loop until the
source stops changing. Two cops can also undo one another forever. When that
happens — a repeated source, or 200 rounds without settling, both RuboCop's
own conditions, which rbcop reproduces — `format` rejects rather than returning
half-corrected source. It also rejects if a correction ever produced source
that does not parse, rather than returning it.

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
once and `formatSync` throws until it has. Everything after that already was
synchronous — `format` was only ever awaiting the boot, and both produce the
same bytes.

Ruby is the one package with a caveat here. The VM's linear memory never
shrinks and only a recycle reclaims it, and recycling is asynchronous — so a
synchronous run that has formatted a large enough file eventually has to come up
for air. `formatSync` says so when it happens; `await init()` again and carry on.
The limit it refuses at is set well above the one `format` recycles at, and the
VM rarely grows near either now that RuboCop runs outside it. The same applies
after the RuboCop pass crashes: replacing the rbcop instance is an
instantiation, so `formatSync` asks for `init()` there too.

Prefer `format` where you can await: it needs no setup call and cannot throw that
error.

## It runs in the browser too

The import does not change — bundlers and browsers pick the `browser` export
condition on their own, and `format` has the same signature and returns the same
bytes. Only the wasm's route in differs: fetched rather than read from disk.

```js
import { format, init } from '@scalar/ruby-fmt'

// Optional. The artifacts resolve next to the module by default, which Vite,
// Rollup, webpack and a plain CDN handle unaided. esbuild does not rewrite
// `new URL(..., import.meta.url)`, so there they need naming.
await init({ url: '/assets/ruby_fmt.wasm.br', rbcop: { url: '/assets/rbcop_fmt.wasm.br' } })

await format(source)
```

Run it in a worker. Booting compiles 28 MB of wasm for syntax_tree and 16 MB for
rbcop, which is a visibly frozen tab if it happens on the main thread.

A fresh Ruby VM starts at ~332 MB of linear memory, and a large file can take it
over the 400 MB ceiling at which `format` recycles it — a ceiling picked for a
Node process. A tab has less room to absorb that than a server does, so keep
large files off the main thread.

The browser reads the same brotli artifacts as Node (5.7 MB and 2.2 MB over the
wire), and `{ rubocop: false }` never fetches the second. It expands them with
`DecompressionStream('brotli')` where the engine has it, or a 208 KB wasm decoder
where it does not — Chrome, today. Serving an artifact with
`Content-Encoding: br`, or serving an uncompressed `.wasm`, skips the decoder
entirely:

```js
await init({
  url: '/assets/ruby_fmt.wasm',
  encoding: 'none',
  rbcop: { url: '/assets/rbcop_fmt.wasm', encoding: 'none' },
})
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
| `options.rubocopConfig` | `Record<string, unknown>` | `{}` | Extra `.rubocop.yml` entries, merged over the ones this package sets — `{ 'Layout/IndentationWidth': { Width: 4 } }`. Ignored when `rubocop` is `false`. [Ruby-only features](#configuring-rubocop) are errors. |

`printWidth` is validated rather than trusted, because it is interpolated into
the Ruby expression that drives the format. TypeScript stops nothing there: the
types are advisory to a JavaScript caller, and `{ printWidth: '80; system("…")' }`
is perfectly expressible in plain JS. A non-integer or non-positive value throws
a `TypeError` instead of reaching Ruby.

Both wasm artifacts are exported under subpaths too, for anyone who wants to
serve or instantiate them themselves:

```ts
import.meta.resolve('@scalar/ruby-fmt/wasm')
// file:///…/node_modules/@scalar/ruby-fmt/ruby_fmt.wasm.br — still brotli-compressed
import.meta.resolve('@scalar/ruby-fmt/rbcop-wasm')
// file:///…/node_modules/@scalar/ruby-fmt/rbcop_fmt.wasm.br
```

---

## The output is exact, and how that is held

The two halves are exact in two different ways, and the difference is worth
being precise about.

**syntax_tree is exact by construction.** This runs **actual CRuby 4.0.0
compiled to WebAssembly** ([ruby.wasm](https://github.com/ruby/ruby.wasm)) with
the **actual [syntax_tree](https://github.com/ruby-syntax-tree/syntax_tree)
gem** baked into it. It is not a reimplementation, so it cannot drift.
`test/native-conformance.test.ts` asserts byte-identical output against the same
gem on a native Ruby. It works because syntax_tree and prettier_print are pure
Ruby whose one native need, Ripper, is part of CRuby.

**The RuboCop pass is exact by test.** It is rbcop, a reimplementation of
RuboCop 1.92.2, and a reimplementation is only as exact as the checking that
holds it there. `test/rubocop-conformance.test.ts` is that checking: it runs the
real `RuboCop::CLI` — the command-line entry point, with every gem version
pinned at activation — over the same syntax_tree output, and asserts
byte-identical results. Set `RUBY_FMT_CONFORMANCE_CORPUS` to a directory of
`.rb` files and it does the same over all of them.

That has been run over two corpora of real Ruby: 300 files, with no divergence,
and 2,754 files from the Ruby 3.3 standard library and RuboCop's own gems,
which found one rbcop bug on 10 of them. rbcop re-indented the wrapped operand
of `/regex/ =~ operand`; parser builds `match_with_lvasgn` for that rather than
a method call, so RuboCop's `Layout/MultilineOperationIndentation` never visits
it. The build fixes it in `build/rbcop_fmt/rbcop-wasm.patch` — the patch's one
change to rbcop's behaviour — and both shapes are now samples in the test,
each confirmed to fail without the fix. With it, all 3,054 files match.

Both tests *assert* rather than report: any divergence is a bug.

The pins live where each half is built. syntax_tree's is in
`build/ruby_fmt/Gemfile`. The RuboCop oracle's are in `build/rbcop_fmt/Gemfile`:
rubocop 1.92.2, rubocop-ast 1.50.0, parser 3.3.12.0 and prism 1.9.0, the
versions rbcop's own parity gates ran against. All four are load-bearing —
RuboCop's Layout output changes between releases, rubocop-ast decides which
parser produces the token stream the Layout cops see, and the
`TargetRubyVersion` this package sets puts RuboCop on prism — so they move only
when the pinned rbcop moves to a newer RuboCop. CI installs exactly those, so
neither test skips there.

---

## What is not stock: three fixes for `case`/`in`, and one for speed

syntax_tree 6.3.0 has a family of bugs in pattern matching, and they all end the
same way — source that parsed on the way in comes back out as source Ruby cannot
read, or, in one case, as Ruby that parses and means something else. `format()`
re-parses everything it returns and raises rather than handing back a broken
file, so what these cost a consumer today is a formatter that refuses whole
files. `src/stree-patch.ts` carries the fixes, applied by reopening the classes
at boot: the artifact stays stock syntax_tree 6.3.0, and retiring a fix once it
lands upstream is deleting a constant.

One more patch, in `src/stree-perf-patch.ts`, is applied the same way and is
listed separately below because it changes no output at all — only how long the
gem takes to produce it.

The RuboCop pass used to carry patches of the same kind — a fix for
[rubocop/rubocop#15761](https://github.com/rubocop/rubocop/issues/15761) and two
speed fixes for rubocop-ast and parser. None survive the move to rbcop: RuboCop
1.92.2 fixed #15761, and the speed fixes patched Ruby code that no longer runs.
rbcop carries one fix of its own instead, described
[above](#the-output-is-exact-and-how-that-is-held).

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

### 4. The comment walk that is quadratic on a multi-byte source

The one patch here that is not a bug fix. `SyntaxTree::Parser#on_comment` tells
an inline comment from a standalone one by walking backwards from the `#` over
spaces and tabs, indexing the source a character at a time. `String#[]` is
constant time only while CRuby can treat a string as one byte per character, so
a single accented letter anywhere in a file makes each of those indexes count
characters from the start of the string — and a file with a comment above most
of its lines does that a great many times: 104,172 of them in one 317 KB file of
generated Ruby carrying four accented characters.

`src/stree-perf-patch.ts` points the walk at a copy of the source with
everything that is not a space, a tab or a newline replaced by `x`: the same
number of characters, so an offset means the same thing in both, and pure ASCII,
so it indexes in constant time. Built once per parse, and not at all for a
source that is already ASCII.

Output is unchanged, which is the whole claim. Two `bun run ruby:bench
--only corpus` comparisons over one generated Ruby SDK, each snapshotted before
and after and `--compare`d — 441 `.rb` files (5.2 MB) with the RuboCop pass on,
and its 438 `.rbi` files (6.7 MB, copied under `.rb` names because the harness
globs for those) with `--no-rubocop`, which is how this SDK's signatures are
formatted. Every one of the 879 hashes the same, in 126 s against the 211 s the
two runs used to take. Only 51 of them carry a multi-byte character and so take
the stand-in at all — but those 51 are around 60% of the bytes, which is the
shape of the problem. The worst file in them — 568 KB carrying two accented
characters — goes from 24.1 s to 3.6 s formatted on its own with the RuboCop
pass off, which is the second row of the table in
`src/stree-perf-patch.ts`. What comes out is the dominant quadratic
term, not every one: formatting a large file is still superlinear in its size,
and still somewhat slower with a multi-byte character in it than without.

### How narrow the divergence is

Measured rather than asserted: formatting the rubocop (1.74 and 1.81),
rubocop-ast, syntax_tree, parser and regexp_parser gems both ways — 2,076 files
— the three fixes change the output of none of them, and none of them starts
failing to format. They fire only where stock syntax_tree emits a syntax
error.

`test/native-conformance.test.ts` pins that in both directions: byte-identity
with native syntax_tree everywhere else — including on a source shaped to run
through the comment walk above — plus a test asserting that native output for
each of the five shapes the three fixes cover still fails to parse while ours
does not, and a sixth checked against the bytes because it is the one whose
native output parses and means something else. When syntax_tree releases a fix,
that test fails and the patch behind it comes out.

Separately, `format()` parses everything it returns and raises instead of
handing back source Ruby cannot read: syntax_tree's output with Ripper, at about
2.7 ms on a 28 ms format, and the RuboCop pass's with Prism, inside rbcop. That
is a good trade for never writing a broken file again.

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
department, and the pass is `--only Layout`. But the two tools ship together, and a consumer who runs a full `rubocop -a`
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
and the rbcop instance are cached values rather than objects you construct.

| File | Exports | Purpose |
|:---|:---|:---|
| `src/format.ts` | `createFormat`, `reprint` | The public entry point: boot what is needed, recycle if needed, validate options, run syntax_tree and then the RuboCop pass. |
| `src/boot-vm.ts` | `createBootVm`, `WORK_DIR` | Instantiates the pre-initialized CRuby, patches syntax_tree, and caches the result. |
| `src/rbcop.ts` | `createRbcop` | Instantiates rbcop, calls its Layout pass, and replaces the instance after a trap. |
| `src/rubocop.ts` | `buildRuboCopConfig` | The `.rubocop.yml` the pass loads: the two entries this package sets, and a caller's merged over them. |
| `src/stree-patch.ts` | `STREE_PATCHES` | The fixes applied on top of syntax_tree, and why each is safe. |
| `src/stree-perf-patch.ts` | `STREE_PERF_PATCHES` | The syntax_tree patch that changes what the gem costs rather than what it writes, and the evidence that output is unchanged. |
| `src/compile-artifact.ts` | `compileArtifact`, `compileRbcopArtifact` | Locates, decompresses and compiles each artifact, at most once per process. |
| `src/fetch-artifact.ts` | `createArtifactLoader` | The browser's counterpart: fetches and expands one artifact. |
| `src/types.ts` | `FormatOptions`, `InitOptions`, … | The types the other files share. |

`bun run build` compiles `src/` to `dist/`, which is what the published package
exports. `dist/` is gitignored, so a fresh clone builds before it packs — the
`prepack` check fails the pack if it has not.

---

## Two artifacts, and how to get them

The package ships `ruby_fmt.wasm.br`, CRuby with syntax_tree in it, and
`rbcop_fmt.wasm.br`, the RuboCop pass. There is no directory to mount at boot
and nothing to resolve at runtime.

Both are stored brotli-compressed — 5.7 MB and 2.2 MB, from 28 MB and 16 MB.
Decompression happens once per process (via `node:zlib`, no dependency added),
not once per format: each compiled `WebAssembly.Module` is cached, so even
recycling the Ruby VM reuses it.

### The Ruby artifact ships already booted

The last step of its build runs [wizer](https://github.com/bytecodealliance/wizer)
over the module: it instantiates CRuby, requires syntax_tree, and writes the
resulting linear memory back into the wasm as data. What you install is a Ruby
VM that has already started, so a cold start and every recycle skip the boot.

The step earned its place when the artifact carried RuboCop too, whose 698 cop
files cost ~9 s to require. With syntax_tree alone it saves less, but it is
still the difference between instantiating a VM and booting one, and it costs
the artifact only ~6.6 MB uncompressed.

`build/ruby_fmt/preinit.ts` is the step, and its header is where the three
non-obvious parts are written down: wizer needs a zero-argument export and CRuby
has none that can load Ruby code, so one is merged in; the initialization has to
travel through `ruby-init` rather than an eval, because wizer traps on any
imported call and evaluating a string reaches one; and the snapshot captures the
guest's preopened directories, so the build has to hand wizer exactly the one
`boot-vm.ts` hands the runtime.

One consequence for the runtime, in `src/boot-vm.ts`: it does not call
`RubyVM.instantiateModule`, because that helper finishes by calling `ruby-init`
— which would reinitialise CRuby underneath the gem already loaded in the
snapshot.

### What keeps the Ruby artifact as small as it is

Everything the formatter never loads is stripped
before packaging: `rdoc`, `bundler`, `irb`, `reline`, and the bundled gem tree
(`rake`, `minitest`, `rexml`, `net-imap`, `typeprof`…). That list is not
guesswork — it is the complement of `$LOADED_FEATURES` after a real format, which
touches just 72 files. `rubygems` stays, because Ruby loads it during startup,
and so does `specifications/`, which backs the default gems that do load. `prism`
stays too, because error_highlight requires it to annotate an exception raised
from prism-compiled code. Then `wasm-opt -Os` runs over what remains, and wizer
runs after that.

Note that `rbwasm --without-stdlib` cannot do any of this: it accepts only `enc`,
and that is a no-op for a static build, which compiles the encodings in.

### Rebuilding them

Both artifacts are committed, so a fresh clone runs the tests with nothing
extra. Rebuild one only when its pins change:

```bash
bun run ruby:build    # ~20 min from cold, needs Ruby + bundler + Bun
```

```bash
bun run rbcop:build   # ~3 min from cold, needs rustup + python3 + node
```

`build/ruby_fmt/Gemfile.lock` and `build/rbcop_fmt/entry/Cargo.lock` are
committed alongside them, so the versions that produced the checked-in bytes are
recoverable rather than whatever resolves today. The rbcop build also
regenerates `licenses/rbcop/` from that lockfile.

The Ruby artifact's bytes are not reproducible. CRuby seeds its `Hash` function
from `random_get` while it starts, and the snapshot is a dump of the heap those
hashes live in, so two builds from identical inputs differ in most of their
bytes and behave identically. A rebuild is checked by running the corpus
comparison in [`CONTRIBUTING.md`](../../CONTRIBUTING.md), not by diffing it
against what is committed.

---

## The Ruby VM's memory, and why it is still recycled

This used to be a known bug with a workaround. Formatting grew the VM's linear
memory by roughly 74 MB per 23 KB of input and never released it, so a process
formatting a whole codebase walked into the wasm32 2 GB wall after ~680 KB and
died with `RangeError: Start offset -… is outside the bounds of the buffer`.

Nearly all of that was RuboCop's. With the RuboCop pass moved out of the VM,
13.8 MB of real Ruby — 2,754 files — grows a fresh VM by ~50 MB in total, and
what growth remains tracks the largest single file rather than adding up: a
75 KB file takes a fresh VM from ~332 MB to ~409 MB, and formatting it again and
again plateaus there. rbcop's own memory plateaus at ~11 MB.

Wasm memory never shrinks, though, so `format()` still watches the VM and
replaces it once its linear memory passes **400 MB**. Recycling reuses the
cached `WebAssembly.Module` and the pre-initialized snapshot, so it costs an
instantiation and nothing more; it now fires only after a large file.
`test/vm-recycle.test.ts` holds both halves of that in place: it formats a file
large enough to cross the ceiling repeatedly, fails unless the VM is replaced
more than once, and fails if linear memory climbs past 800 MB.

The threshold is far below the 2 GB wall on purpose: a recycle cannot release
the outgoing VM's linear memory synchronously, so the process briefly holds the
old buffer and the new one together, and 400 MB keeps that pair near 1 GB.
`formatSync` cannot recycle at all, so it refuses past 1.2 GB instead, with an
error saying to `await init()`.

---

## Implementation notes worth knowing

Each of these cost real debugging time, so they are recorded here. The rbcop
build has its own in [`build/rbcop_fmt/SPIKE.md`](../../build/rbcop_fmt/SPIKE.md)
— bindgen, wasi-sdk and linking.

**`node:wasi` is not usable for this**, even though the package only ever runs
on Node. `@ruby/wasm-wasi` wants a `{ wasiImport, initialize }` pair, which
Node's built-in WASI does provide — so it fits on paper. It does not fit
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
both interpolation and a command-substitution attempt. The RuboCop pass takes
the source and its config as bytes in its own memory, and runs no Ruby at all.

## Community

We are API nerds. You too? Let's chat on Discord: <https://discord.gg/scalar>

## License

MIT for this package's own source. `ruby_fmt.wasm` embeds CRuby and the `logger`
gem (Ruby License / BSD-2-Clause), and syntax_tree, prettier_print and the `js`
gem (MIT). `rbcop_fmt.wasm` embeds rbcop, RuboCop's configuration and that of
seven RuboCop plugins (MIT), and 67 Rust crates (MIT, Apache-2.0, Unlicense,
BSD-2-Clause, BSL-1.0 or Unicode-3.0). Both statically link wasi-libc. All
permissive, with every text reproduced; see [`licenses/NOTICE.md`](licenses/NOTICE.md).
