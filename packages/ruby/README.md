# Scalar Ruby Formatter

[![Version](https://img.shields.io/npm/v/%40scalar%2Fruby-fmt)](https://www.npmjs.com/package/@scalar/ruby-fmt)
[![Downloads](https://img.shields.io/npm/dm/%40scalar%2Fruby-fmt)](https://www.npmjs.com/package/@scalar/ruby-fmt)
[![License](https://img.shields.io/npm/l/%40scalar%2Fruby-fmt)](https://www.npmjs.com/package/@scalar/ruby-fmt)
[![Discord](https://img.shields.io/discord/1135330207960678410?style=flat&color=5865F2)](https://discord.gg/scalar)

`rubocop --autocorrect --only Layout`, byte-identical to RuboCop 1.92.2, via [rbcop](https://github.com/costajohnt/rbcop) compiled to WebAssembly and callable from TypeScript on plain Node.

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
import { format, formatSync } from '@scalar/ruby-fmt'

await format('class A\n  def initialize(b)\n@b=b\n  end\nend')
// class A
//   def initialize(b)
//     @b = b
//   end
// end

formatSync('def call(user)\n  return unless user\n  user.name\nend\n')
// def call(user)
//   return unless user
//
//   user.name
// end
```

The first call decompresses, compiles and instantiates the module, about a
quarter of a second all in; every later call takes a few milliseconds. Under
Node all of that is synchronous, so `formatSync` works straight away, with no
`init()`.

---

## What it does, and what it does not

This package is RuboCop's Layout department and nothing else: indentation,
alignment, blank lines, spacing, and line length. It corrects Layout **within
the line structure it is handed**. It does not reprint: it never throws away
the input's line breaks and decides them again, the way a pretty-printer does.

That makes it the right tool for input that is already line-structured — and
generated code is the main case, because a generator already decides where its
lines break. It is the wrong tool for collapsing or exploding hand-written code
into a canonical shape. It will not turn this into one statement per line:

```ruby
def x; a; b; end
```

and it leaves this alone too, because it has no Layout offense, by RuboCop's
own reckoning:

```ruby
class Client
  def initialize(base_url:, token: nil); @base_url = base_url; @token = token; end
end
```

Only Layout, and on purpose. RuboCop's other departments rewrite code rather
than lay it out — `-A` will happily delete an unused assignment or turn an `if`
into a ternary — which is not something a function called `format` should do.

### Line length

`printWidth` is `Layout/LineLength`'s `Max`. It defaults to **120**, RuboCop's
own default, so that with no options at all the output is exactly what stock
`rubocop --autocorrect --only Layout` writes.

It is a cop's limit, not a printer's width, and the cop's autocorrect is
limited. It breaks a long line at an argument list, a collection literal or a
block's braces, and nowhere else:

```ruby
# printWidth: 80, in
result = client.request(method: :get, path: "/v1/items", query: { page: 1, per_page: 100 }, headers: { "accept" => "json" })

# out
result = client.request(method: :get, path: "/v1/items",
                        query: { page: 1, per_page: 100 }, headers: { "accept" => "json" })
```

So, worth knowing before you lower it:

- **A line with nowhere to break stays long.** A long string literal, a long
  constant assignment, a long comment.
- **A broken line can still be over the limit.** The second line above is 91
  characters, and RuboCop leaves it there.
- **A long brace-block lambda is broken at its braces and its arguments,** which
  is rarely what you would write by hand:

  ```ruby
  # printWidth: 80
  HANDLER = ->(request) {
    request.params.fetch(:page).to_i.clamp(1,
                                           100).then { |page|
      paginate(page, request)
    }
  }
  ```

All of that is RuboCop's own behaviour, byte for byte — the conformance test
below holds the package to it at the default width and at 80. If what goes in
already has the line structure you want, leave `printWidth` at 120 or above and
the cop has little to do.

### When it gives up

It rejects rather than returning anything when:

- **The source does not parse.** The error names the line and Prism's message.
  RuboCop itself would report a `Lint/Syntax` offense and correct nothing.
- **A correction never settles.** Corrections can introduce offenses, so RuboCop
  corrects in a loop until the source stops changing, and two cops can undo one
  another forever. When that happens — a repeated source, or 200 rounds without
  settling, RuboCop's own conditions — this rejects with RuboCop's own
  `Infinite loop detected … caused by …` message, where RuboCop would give up
  on the file too.
- **A correction produced source that does not parse.** Never handed back.

### Configuring RuboCop

```js
await format(source, { rubocopConfig: { 'Layout/IndentationWidth': { Width: 4 } } })
```

Merged over the two entries this package sets (`TargetRubyVersion` and
`Layout/LineLength`'s `Max`), one level deep, and written as the `.rubocop.yml`
the pass loads. Anything a `.rubocop.yml` can say about Layout cops belongs
here, spelled exactly as that file spells it. Naming a cop replaces this
package's entry for it, so `{ 'Layout/LineLength': { Max: 100 } }` or
`{ 'Layout/LineLength': { Enabled: false } }` wins over `printWidth`.

What it cannot do is run Ruby, because the pass has none. ERB in the config, a
remote `inherit_from` URL, `require:` and custom cops all need one, and each is
an error naming what was asked for rather than a config quietly read some other
way. A value of the wrong type — `{ Width: 'four' }` — fails where RuboCop's own
`TypeError` would, and the next format goes through as normal.

### What it costs

Measured on one machine (4 cores, Node 22), over 300 files of real Ruby from
the standard library (1.3 MB), against the 0.8 release, which ran a reprinter on
CRuby compiled to wasm before this pass:

| | 0.8 | now |
|:---|---:|---:|
| first `format()` in a fresh process | ~440 ms | **~210 ms** |
| per file, mean | 23.6 ms | **3.9 ms** |
| per file, median | 17.5 ms | **2.5 ms** |
| all 300 files | 7.1 s | **1.2 s** |
| peak resident memory, whole run | ~600 MB | **160 MB** |
| wasm linear memory | ~332 MB, never shrinks | **3.3 MB at boot, 10 MB after** |
| installed, `node_modules` total | 9.1 MB | **2.7 MB** |

The cost is the pass alone now. The instance keeps every config it has
resolved, so the first format with a given set of options pays ~100 ms to merge
it over RuboCop's `default.yml` and every later one pays nothing for it. Its
linear memory grows to fit the largest file it has been handed and stays there
— 31 MB after 13 MB of Ruby with files up to 400 KB, and not a byte more when
the same files go through again — so nothing has to be recycled.

The installed total is the package (2.4 MB, nearly all of it the artifact), the
WASI shim, and the brotli decoder the browser build imports only where an engine
lacks native brotli. Under 0.8 it also carried `@ruby/wasm-wasi` and the 5.7 MB
CRuby artifact.

---

## Formatting without awaiting

`formatSync` is for callers with no `await` to give — a code generator that
formats each file inside the synchronous builder that emits it, a template
renderer, a plugin hook that has to return a string.

```js
import { formatSync } from '@scalar/ruby-fmt'

const formatted = formatSync(source)
```

Under Node it needs nothing first: reading, decompressing, compiling and
instantiating the module are all synchronous, and `format` runs exactly the same
code. `init()` is still exported, for compatibility and for moving the cold
start somewhere of your choosing; it is never required under Node.

If the pass crashes — rbcop is Rust, and a panic traps the wasm instance — that
format throws, and the next one runs on a fresh instance, synchronously.

## It runs in the browser too

The import does not change — bundlers and browsers pick the `browser` export
condition on their own, and `format` has the same signature and returns the same
bytes. Only the wasm's route in differs: fetched rather than read from disk.

```js
import { format, formatSync, init } from '@scalar/ruby-fmt'

// Optional for `format`, required once before `formatSync`: a fetch is the one
// step a browser cannot do synchronously. The artifact resolves next to the
// module by default, which Vite, Rollup, webpack and a plain CDN handle unaided.
// esbuild does not rewrite `new URL(..., import.meta.url)`, so there it needs
// naming.
await init({ url: '/assets/rbcop_fmt.wasm.br' })

await format(source)
formatSync(source)
```

Run it in a worker. Booting compiles 16 MB of wasm, which is a visibly frozen tab
on the main thread. A main thread also refuses to instantiate a module this size
synchronously, so there a crash in the pass makes `formatSync` ask for another
`await init()`; in a worker, and under Node, recovery is synchronous.

The browser reads the same 2.2 MB brotli artifact as Node. It expands it with
`DecompressionStream('brotli')` where the engine has it, or a 208 KB wasm decoder
where it does not — Chrome, today. Serving the artifact with
`Content-Encoding: br`, or serving an uncompressed `.wasm`, skips the decoder
entirely:

```js
await init({ url: '/assets/rbcop_fmt.wasm', encoding: 'none' })
```

## API

The package is written in TypeScript and ships its own declarations, so these
types are generated from the source rather than maintained beside it.

### `format(source, options?): Promise<string>`

### `formatSync(source, options?): string`

```ts
import { format, type FormatOptions } from '@scalar/ruby-fmt'

const options: FormatOptions = { printWidth: 100 }

const formatted: string = await format('foo(aaaaaaaaaa, bbbbbbbbbb, cccccccccc, dddddddddd)', options)
```

| Parameter | Type | Default | Notes |
|:---|:---|:---|:---|
| `source` | `string` | — | Ruby source. Invalid syntax rejects. |
| `options.printWidth` | `number` | `120` | `Layout/LineLength`'s `Max` — RuboCop's own default. Must be a positive integer. [See above](#line-length). |
| `options.rubocopConfig` | `Record<string, unknown>` | `{}` | Extra `.rubocop.yml` entries, merged over the ones this package sets — `{ 'Layout/IndentationWidth': { Width: 4 } }`. [Ruby-only features](#configuring-rubocop) are errors. |

`rubocop: false`, from 0.8, throws a `TypeError`: there is nothing left to run
without RuboCop, and returning the input would pass for formatting.

### `init(options?): Promise<void>`

Boots the module ahead of the first format. Never required under Node. In the
browser build it takes `{ url, bytes, encoding }`, all optional, describing
`rbcop_fmt.wasm.br`, and is required once before `formatSync`.

The artifact is exported under a subpath too, for anyone who wants to serve or
instantiate it themselves:

```ts
import.meta.resolve('@scalar/ruby-fmt/wasm')
// file:///…/node_modules/@scalar/ruby-fmt/rbcop_fmt.wasm.br — still brotli-compressed
```

`@scalar/ruby-fmt/rbcop-wasm` resolves to the same file, as it did in 0.8.

---

## The output is exact by test, and how that is held

rbcop is RuboCop 1.92.2 reimplemented in Rust on Prism — not RuboCop compiled to
wasm — so by this repository's rule it is not exact by construction. It is exact
by test, and a reimplementation is exact only for as long as something keeps
checking it.

`test/rubocop-conformance.test.ts` is that checking. It runs the real
`RuboCop::CLI` — the command-line entry point, with every gem version pinned at
activation — over the same input with the same `.rubocop.yml`, and asserts
byte-identical output, at the default width and at 80. Where RuboCop gives up on
a file, the package has to reject it. Set `RUBY_FMT_CONFORMANCE_CORPUS` to a
directory of `.rb` and `.rbi` files and it does the same over all of them.

Without the reprinter, it has been run over two corpora, each at both widths:
the 300 files above, and 2,184 `.rb` and `.rbi` files from the Ruby 3.3
standard library, rubocop, rubocop-ast, parser, syntax_tree and prism's
generated Sorbet signatures (13 MB). With the patch below, every file matches.
Before that, with the reprinter in front, it ran over 3,054 files. Across every corpus run so far, three rbcop
bugs have turned up, all fixed:

- `Layout/MultilineOperationIndentation` re-indented the wrapped operand of
  `/regex/ =~ operand`, which RuboCop never visits: parser builds
  `match_with_lvasgn` for it rather than a method call. Patched in
  `build/rbcop_fmt/rbcop-wasm.patch`.
- A `case/in` guard continued over lines was aligned with its condition rather
  than indented from the `in`. Fixed in rbcop itself, upstream.
- `Layout/EmptyLineAfterGuardClause` skipped a guard clause followed by a
  statement on the same line (`break if a; b = 1`) everywhere. RuboCop skips it
  only where the two share an implicit `begin`, so inside a `begin … end` with
  no `rescue` it flags it, and then loops against
  `Layout/EmptyLinesAroundBeginBody` until it gives up. Patched in
  `build/rbcop_fmt/rbcop-wasm.patch`, so the package now gives up too. Found in
  the standard library's `time.rb`.

Each one is a sample in the test, confirmed to fail without its fix.

The oracle's pins are in `build/rbcop_fmt/Gemfile`: rubocop 1.92.2,
rubocop-ast 1.50.0, parser 3.3.12.0 and prism 1.9.0, the versions rbcop's own
parity gates ran against. All four are load-bearing — RuboCop's Layout output
changes between releases, rubocop-ast decides which parser produces the token
stream the Layout cops see, and the `TargetRubyVersion` this package sets puts
RuboCop on prism — so they move only when the pinned rbcop moves to a newer
RuboCop. CI installs exactly those, so the test does not skip there.

---

## Source layout

One function per file, arrow functions throughout, and no classes — the rbcop
instance is a cached value rather than an object you construct.

| File | Exports | Purpose |
|:---|:---|:---|
| `src/format.ts` | `createFormat` | The public functions: check the options, boot rbcop, run the pass. |
| `src/rbcop.ts` | `createRbcop` | Instantiates rbcop - synchronously where the engine allows - calls its Layout pass, and replaces the instance after a trap. |
| `src/rubocop.ts` | `buildRuboCopConfig`, `DEFAULT_PRINT_WIDTH` | The `.rubocop.yml` the pass loads: the two entries this package sets, and a caller's merged over them. |
| `src/compile-artifact.ts` | `nodeArtifact` | Node: reads, decompresses and compiles the artifact synchronously, once per process. |
| `src/fetch-artifact.ts` | `createArtifactLoader` | The browser's counterpart: fetches and expands the artifact. |
| `src/types.ts` | `FormatOptions`, `InitOptions`, … | The types the other files share. |

`bun run build` compiles `src/` to `dist/`, which is what the published package
exports. `dist/` is gitignored, so a fresh clone builds before it packs — the
`prepack` check fails the pack if it has not.

---

## The artifact, and how to rebuild it

The package ships one artifact, `rbcop_fmt.wasm.br`: rbcop's Layout pass as a
WASI reactor, 16 MB of wasm stored brotli-compressed at 2.2 MB. Decompression
happens once per process (via `node:zlib`, no dependency added), not once per
format, and the compiled `WebAssembly.Module` is cached, so replacing a trapped
instance reuses it.

It is committed, so a fresh clone runs the tests with nothing extra. Rebuild it
only when its pins, its patch or `build/rbcop_fmt/entry` change:

```bash
bun run rbcop:build   # ~3 min from cold, needs rustup + python3 + node
```

`build/rbcop_fmt/entry/Cargo.lock` is committed alongside it, so the versions
that produced the checked-in bytes are recoverable rather than whatever resolves
today, and the build regenerates `licenses/NOTICE.md` from that lockfile. The
build is reproducible up to the source paths Rust records for panic messages,
which depend on where the toolchain is installed. A rebuild is checked by the
conformance test, and by a `bun run ruby:bench` corpus comparison, not by
diffing bytes. [`build/rbcop_fmt/SPIKE.md`](../../build/rbcop_fmt/SPIKE.md) has
the rest — bindgen, wasi-sdk, linking, and how the package got here.

---

## Implementation notes worth knowing

**WASI comes from [`@bjorn3/browser_wasi_shim`](https://github.com/bjorn3/browser_wasi_shim),
not `node:wasi`.** It is pure JavaScript with no native build step, its
in-memory filesystem means the configs rbcop writes never touch disk, and
carrying no Node built-ins of its own it is what lets the Node and browser
builds run the same file.

**In the shim, `fds` is the entire file-descriptor table.** Indices 0, 1 and 2
must be stdin, stdout and stderr; preopened directories start at index 3.
Passing a `PreopenDirectory` as the first element does not raise — it silently
becomes stdin, and every path lookup then fails with `ENOENT`. Relatedly, the
shim's `debug.enable(undefined)` resolves to `true`, so `{ debug: false }` must
be passed explicitly or every syscall is traced to stdout.

## Input handling

The source and the config are copied into the module's own memory as bytes, and
nothing evaluates either: there is no Ruby in the pass. The config is built as
JSON, which RuboCop's YAML loader reads, so a caller's strings are escaped
exactly rather than by hand-rolled YAML quoting.

## Upgrading from 0.8

0.8 reprinted every file before this pass ran. Output changes for any input
whose line structure the reprinter used to change, and:

- `rubocop: false` throws instead of meaning "reprint only".
- `printWidth` now means `Layout/LineLength`'s `Max`, and defaults to 120
  rather than 80.
- The browser build's `init` takes `{ url, bytes, encoding }` for
  `rbcop_fmt.wasm.br` at the top level. `init({ rbcop: { … } })` throws, and a
  top-level `url` no longer means the reprinter's artifact, which is gone.
- `@scalar/ruby-fmt/wasm` now resolves to `rbcop_fmt.wasm.br`.
- `formatSync` no longer needs `init()` under Node, and never refuses for memory.

## Community

We are API nerds. You too? Let's chat on Discord: <https://discord.gg/scalar>

## License

MIT for this package's own source. `rbcop_fmt.wasm` embeds rbcop, RuboCop's
configuration and that of seven RuboCop plugins (MIT), and the Rust crates it
links — MIT where a crate offers it, otherwise BSD-2-Clause, Unicode-3.0 or
BSL-1.0 — and statically links wasi-libc (MIT, with BSD parts). All permissive.
[`licenses/NOTICE.md`](licenses/NOTICE.md) carries every copyright notice and
each license text once, and is generated by `build/licenses/collect.py`.
