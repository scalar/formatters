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

  // A Java exception reaches JavaScript as a Java proxy with no readable
  // message, so failures are encoded in the result rather than thrown across
  // the boundary. This asserts ktfmt's own diagnostic survives that encoding,
  // line and column included.
  it('rejects invalid syntax with ktfmt’s diagnostic', async () => {
    expect(format('fun f( {')).rejects.toThrow(/ParseError: 1:7: error: Expecting '\)'/)
  })
})

describe('formatSync', () => {
  it('produces the same bytes as the async format', async () => {
    const source = 'fun  f( ) {\nval x=1\n}'
    const expected = await format(source)
    expect(formatSync(source)).toBe(expected)
  })

  it('reports a parse failure rather than returning the source unchanged', async () => {
    await init()
    expect(() => formatSync('fun f( {')).toThrow()
  })

  it('stays usable after a failed format', async () => {
    await init()
    expect(() => formatSync('fun f( {')).toThrow()
    expect(formatSync('fun  f( ) {\nval x=1\n}')).toBe('fun f() {\n  val x = 1\n}\n')
  })

  it('returns a string rather than a promise, which is the whole point', async () => {
    await init()
    const result = formatSync('fun  f( ) {\nval x=1\n}') as unknown
    expect(result).toBeString()
    expect(result).not.toHaveProperty('then')
  })
})
