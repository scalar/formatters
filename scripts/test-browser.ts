// Loads each package's *browser* build in a real browser and formats through it.
//
// This is the browser counterpart of `bun run test:node`, and it exists for the
// same reason: a package that claims an environment has to be run in that
// environment, or the claim decays into an assumption. `test:node` proves the
// Node entry needs nothing but Node; this proves the browser entry needs nothing
// but a browser - no `node:` built-ins, no `process`, no filesystem.
//
// It runs against `dist`, not `src`, because `dist/index.browser.js` behind the
// `browser` export condition is exactly what a bundler resolves and what a
// consumer ships. So `bun run build` has to have happened first, which is why
// the `test:browser` script does it.
//
// Bare specifiers are resolved into an import map rather than bundled. A real
// consumer's bundler does that resolution for them; doing it here keeps the
// test honest about what the built files import without dragging a bundler into
// the repo. Anything the artifact loader gets wrong - a bad relative URL, a
// stray Node built-in, a missing dependency - still fails here.

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { brotliDecompressSync } from 'node:zlib'

import { chromium } from 'playwright'

/** One assertion per package: format this, expect exactly that. */
type BrowserCase = {
  /** Package directory under `packages/`. */
  directory: string
  /** The committed artifact, relative to the package directory. */
  artifact: string
  /** Source handed to `format`. */
  source: string
  /** The output the Node build produces for that source, byte for byte. */
  expected: string
}

const CASES: BrowserCase[] = [
  {
    directory: 'rust',
    artifact: 'rust_fmt.wasm.br',
    source: 'pub fn add(a: i32,b:i32)->i32{a+b}',
    expected: 'pub fn add(a: i32, b: i32) -> i32 {\n    a + b\n}\n',
  },
  {
    directory: 'swift',
    artifact: 'swift_fmt.wasm.br',
    source: 'struct P{var x:Int\nvar y:Int}',
    expected: 'struct P {\n  var x: Int\n  var y: Int\n}\n',
  },
  {
    directory: 'ruby',
    artifact: 'ruby_fmt.wasm.br',
    source: 'class A\n  def initialize(b)\n@b=b\n  end\nend',
    expected: 'class A\n  def initialize(b)\n    @b = b\n  end\nend\n',
  },
  {
    directory: 'java',
    artifact: 'java_fmt.wasm.br',
    source: 'class A{int x  =  1;void f(){g( "hi" );}}',
    expected: 'class A {\n  int x = 1;\n\n  void f() {\n    g("hi");\n  }\n}\n',
  },
  {
    directory: 'kotlin',
    artifact: 'kotlin_fmt.wasm.br',
    source: 'fun  f( ) {\nval x=1\n}',
    expected: 'fun f() {\n  val x = 1\n}\n',
  },
]

const ROOT = path.join(import.meta.dir, '..')

/** Bare specifiers each browser bundle imports, mapped to paths this server can serve. */
const importMap = (packageDirectory: string): Record<string, string> => {
  const manifest = JSON.parse(readFileSync(path.join(packageDirectory, 'package.json'), 'utf8')) as {
    name: string
    dependencies?: Record<string, string>
    exports?: Record<string, unknown>
  }

  const dependencies = Object.keys(manifest.dependencies ?? {}).map((specifier) => {
    // Resolved from the package's own directory, so a hoisted install and a
    // nested one both land on the file the package would actually load.
    const resolved = Bun.resolveSync(specifier, packageDirectory)
    return [specifier, `/${path.relative(ROOT, resolved)}`] as const
  })

  // Self-references, for the subpaths a package exports to itself - Java and
  // Kotlin import TeaVM's runtime as `<name>/runtime` so a bundler can follow a
  // literal specifier. A bundler resolves those through `exports`; here they go
  // in the import map alongside everything else.
  const own = Object.entries(manifest.exports ?? {})
    .filter(
      ([subpath, target]) => subpath.startsWith('./') && subpath !== './package.json' && typeof target === 'string',
    )
    .map(
      ([subpath, target]) =>
        [
          `${manifest.name}${subpath.slice(1)}`,
          `/${path.relative(ROOT, path.join(packageDirectory, target as string))}`,
        ] as const,
    )

  return Object.fromEntries([...dependencies, ...own])
}

/**
 * The handful of types this server has to get right.
 *
 * `.wasm` and the module types are load-bearing: a browser refuses a module
 * script served as anything but JavaScript, so a wrong guess here would fail as
 * a mysterious import error rather than as a bad header.
 */
const CONTENT_TYPES: Record<string, string> = {
  '.wasm': 'application/wasm',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
}

const contentType = (file: string): string => CONTENT_TYPES[path.extname(file)] ?? 'application/octet-stream'

const server = Bun.serve({
  port: 0,
  fetch(request) {
    const { pathname } = new URL(request.url)

    // The harness page, served from the same origin as everything it imports.
    // `setContent` would leave the page on `about:blank`, where a module import
    // is cross-origin and an import map does not apply.
    const harness = pathname.match(/^\/__harness__\/([\w-]+)$/)
    if (harness?.[1]) {
      const imports = importMap(path.join(ROOT, 'packages', harness[1]))
      return new Response(
        `<!doctype html><meta charset="utf-8"><script type="importmap">${JSON.stringify({ imports })}</script>`,
        { headers: { 'content-type': 'text/html' } },
      )
    }

    // The artifact already expanded, standing in for a host that serves it with
    // `Content-Encoding: br` or publishes an uncompressed `.wasm`. That is the
    // path `init({ encoding: 'none' })` documents, and the one that skips the
    // brotli decoder entirely, so it is worth proving rather than asserting.
    const raw = pathname.match(/^\/__raw__\/([\w-]+)$/)
    if (raw?.[1]) {
      const found = CASES.find((entry) => entry.directory === raw[1])
      if (!found) return new Response('not found', { status: 404 })
      const compressed = readFileSync(path.join(ROOT, 'packages', found.directory, found.artifact))
      return new Response(brotliDecompressSync(compressed), { headers: { 'content-type': 'application/wasm' } })
    }

    const file = path.join(ROOT, decodeURIComponent(pathname))

    // Confined to the repo: a served path that escapes it is a bug in the test,
    // not something to quietly follow.
    if (!file.startsWith(ROOT) || !existsSync(file)) return new Response('not found', { status: 404 })

    return new Response(Bun.file(file), { headers: { 'content-type': contentType(file) } })
  },
})

const origin = `http://localhost:${server.port}`

// The bundled chromium's path, because the versions Playwright downloads and the
// one an image pre-installs do not have to match. Unset, Playwright picks its own.
const executablePath = process.env['CHROMIUM_EXECUTABLE']
const browser = await chromium.launch({
  args: ['--no-sandbox'],
  ...(executablePath ? { executablePath } : {}),
})

const failed: string[] = []

for (const { directory, source, expected } of CASES) {
  const packageDirectory = path.join(ROOT, 'packages', directory)
  const entry = path.join(packageDirectory, 'dist', 'index.browser.js')

  console.log(`\n=== ${directory} ===`)

  if (!existsSync(entry)) {
    console.error(`  dist/index.browser.js is missing - run \`bun run build\` first`)
    failed.push(directory)
    continue
  }

  const page = await browser.newPage()
  const problems: string[] = []
  page.on('pageerror', (error) => problems.push(error.message))

  await page.goto(`${origin}/__harness__/${directory}`)

  const entryUrl = `${origin}/${path.relative(ROOT, entry)}`

  try {
    // Every assertion runs in the page. Anything that reaches for a Node
    // built-in throws here rather than resolving to a shim.
    const result = await page.evaluate(
      async ([entryUrl, source]) => {
        const started = performance.now()
        const module = await import(/* webpackIgnore: true */ entryUrl as string)
        const output = await module.format(source)
        return { output, ms: Math.round(performance.now() - started), hasInit: typeof module.init === 'function' }
      },
      [entryUrl, source] as const,
    )

    if (result.output !== expected) {
      console.error(`  output did not match the Node build`)
      console.error(`    expected ${JSON.stringify(expected)}`)
      console.error(`    received ${JSON.stringify(result.output)}`)
      failed.push(directory)
    } else if (!result.hasInit) {
      console.error(`  the browser entry does not export init`)
      failed.push(directory)
    } else {
      console.log(`  formats in the browser, byte-identical to Node (${result.ms}ms cold)`)
    }

    // A second page, because `init` configures the loader before it compiles and
    // the first one has already compiled. Same output, different route in.
    const rawPage = await browser.newPage()
    await rawPage.goto(`${origin}/__harness__/${directory}`)
    const viaInit = await rawPage.evaluate(
      async ([entryUrl, source, rawUrl]) => {
        const module = await import(/* webpackIgnore: true */ entryUrl as string)
        await module.init({ url: rawUrl, encoding: 'none' })
        return module.format(source)
      },
      [entryUrl, source, `${origin}/__raw__/${directory}`] as const,
    )
    await rawPage.close()

    if (viaInit !== expected) {
      console.error(`  init({ encoding: 'none' }) did not produce the same output`)
      failed.push(directory)
    } else {
      console.log(`  formats from an uncompressed artifact via init, no decoder involved`)
    }
  } catch (error) {
    console.error(`  ${error instanceof Error ? error.message : String(error)}`)
    failed.push(directory)
  }

  if (problems.length > 0) {
    console.error(`  page errors: ${problems.join('; ')}`)
    if (!failed.includes(directory)) failed.push(directory)
  }

  await page.close()
}

await browser.close()
server.stop()

if (failed.length > 0) {
  console.error(`\n${failed.length} package(s) failed in the browser: ${failed.join(', ')}`)
  process.exit(1)
}

console.log(`\nAll ${CASES.length} browser build(s) passed.`)
