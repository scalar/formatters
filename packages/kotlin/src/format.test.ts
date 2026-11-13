// Imports the wired entry point rather than `createFormat`, because `format`
// bound to the on-disk artifact is what a Node consumer actually gets.
import { format, formatSync, init } from './index'
import type { FormatOptions } from './types'
import { describe, expect, it } from 'bun:test'

describe('format', () => {
  it('formats a function body', async () => {
    const out = await format('fun f(){val x=listOf(1,2,3)\nreturn}')
    expect(out).toBe('fun f() {\n  val x = listOf(1, 2, 3)\n  return\n}\n')
  })

  it('is idempotent', async () => {
    const once = await format('class A{fun f(){val xs=intArrayOf(1,2,3)}}')
    expect(await format(once)).toBe(once)
  })

  it('defaults to meta style, as the tool does', async () => {
    // ktfmt's help: "If none of the style options are passed, Meta's style is used."
    expect(await format('fun f(){val x=1}')).toBe(await format('fun f(){val x=1}', { style: 'meta' }))
  })

  it('indents with four spaces in kotlinlang style', async () => {
    const options: FormatOptions = { style: 'kotlinlang' }
    expect(await format('fun f(){val x=1}', options)).toBe('fun f() {\n    val x = 1\n}\n')
  })

  it('uses a two-space continuation in google style', async () => {
    const google = await format('fun f(){someCall(aaaa,bbbb,cccc,dddd)}', { style: 'google', maxWidth: 20 })
    const meta = await format('fun f(){someCall(aaaa,bbbb,cccc,dddd)}', { style: 'meta', maxWidth: 20 })
    expect(google).toContain('\n    aaaa,')
    expect(meta).toContain('\n      aaaa,')
  })

  it('removes unused imports by default and keeps them when asked', async () => {
    const source = 'import kotlin.math.max\nfun f(){}'
    expect(await format(source)).toBe('fun f() {}\n')
    expect(await format(source, { removeUnusedImports: false })).toContain('import kotlin.math.max')
  })

  it('breaks at maxWidth', async () => {
    const out = await format('fun f(){someCall(aaaa,bbbb,cccc,dddd)}', { maxWidth: 20 })
    expect(out.split('\n').every((line) => line.length <= 20)).toBe(true)
  })

  it('preserves comments and kdoc', async () => {
    const out = await format('/** Does a thing. */\n// leading\nclass A{ /* inner */ }')
    expect(out).toContain('/** Does a thing. */')
    expect(out).toContain('// leading')
    expect(out).toContain('/* inner */')
  })

  it('handles UTF-8 without corrupting bytes', async () => {
    const out = await format('fun f(){val s="héllo wörld 🌍"}')
    expect(out).toContain('héllo wörld 🌍')
  })

  it('reuses one module across calls', async () => {
    const [a, b] = await Promise.all([format('class A{}'), format('class B{}')])
    expect(a).toBe('class A {}\n')
    expect(b).toBe('class B {}\n')
  })

  it('rejects invalid syntax with ktfmt’s diagnostic', async () => {
    // ktfmt's message, line and column included. The CLI prefixes the file
    // name; there is no file here, so the message starts at the line.
    expect(format('fun f( {')).rejects.toThrow("1:7: error: Expecting ')'")
  })

  it('accepts top-level statements, as ktfmt does on stdin', async () => {
    // Source is parsed as a script, which is how ktfmt reads stdin.
    expect(await format('println( "hi" )')).toBe('println("hi")\n')
  })

  it('drops a leading byte-order mark, as the ktfmt CLI does', async () => {
    expect(await format('\uFEFFclass A{}')).toBe('class A {}\n')
  })

  it('refuses an option it does not know rather than falling back to a default', async () => {
    expect(format('class A{}', { style: 'android' as 'meta' })).rejects.toThrow(/unknown style/)
    expect(format('class A{}', { trailingCommas: 'always' as 'none' })).rejects.toThrow(/unknown trailingCommas/)
    expect(format('class A{}', { maxWidth: -1 })).rejects.toThrow(/maxWidth must be a non-negative integer/)
    // Names that exist on every object's prototype are still unknown options.
    expect(format('class A{}', { style: 'toString' as 'meta' })).rejects.toThrow(/unknown style/)
    expect(format('class A{}', { trailingCommas: 'constructor' as 'none' })).rejects.toThrow(/unknown trailingCommas/)
  })

  it('recovers from source nested past what the engine’s stack can follow', async () => {
    // ktfmt itself overflows its stack well before this depth. Here the trap
    // costs the instance, so what matters is that it is reported and that the
    // next call gets a fresh one.
    const deep = `val x = ${'('.repeat(100_000)}1${')'.repeat(100_000)}`
    expect(format(deep)).rejects.toThrow(/ran out of stack/)
    expect(await format('class A{}')).toBe('class A {}\n')
  })
})

describe('formatSync', () => {
  it('formats with no init under Node, where booting is synchronous', () => {
    expect(formatSync('fun  f( ) {\nval x=1\n}')).toBe('fun f() {\n  val x = 1\n}\n')
  })

  it('produces the same bytes as the async format', async () => {
    const source = 'fun  f( ) {\nval x=1\n}'
    expect(formatSync(source)).toBe(await format(source))
  })

  it('reports a parse failure rather than returning the source unchanged', () => {
    expect(() => formatSync('fun f( {')).toThrow()
  })

  it('stays usable after a failed format', () => {
    expect(() => formatSync('fun f( {')).toThrow()
    expect(formatSync('fun  f( ) {\nval x=1\n}')).toBe('fun f() {\n  val x = 1\n}\n')
  })

  it('accepts init as a harmless no-op', async () => {
    await init()
    await init()
    const result = formatSync('fun  f( ) {\nval x=1\n}') as unknown
    expect(result).toBeString()
    expect(result).not.toHaveProperty('then')
  })
})
