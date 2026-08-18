// Imports the wired entry point rather than `createFormat`, because `format`
// bound to the on-disk artifact is what a Node consumer actually gets.
import { format, formatSync, init } from './index'
import type { FormatOptions } from './types'
import { describe, expect, it } from 'bun:test'

describe('format', () => {
  it('formats a struct body', async () => {
    const out = await format('struct P{var x:Int\nvar y:Int}')
    expect(out).toBe('struct P {\n  var x: Int\n  var y: Int\n}\n')
  })

  it('is idempotent', async () => {
    const once = await format('func f(a:Int,b:Int)->Int{return a+b}')
    expect(await format(once)).toBe(once)
  })

  // Two members rather than one, because swift-format collapses a body that
  // fits onto a single line and there is then no indentation to observe.
  it('indents with the configured width', async () => {
    const options: FormatOptions = { indentation: { spaces: 4 } }
    const out = await format('struct P{var x:Int\nvar y:Int}', options)
    expect(out).toBe('struct P {\n    var x: Int\n    var y: Int\n}\n')
  })

  it('breaks lines at the configured length', async () => {
    const source = 'let xs = [oneValue, twoValue, threeValue, fourValue, fiveValue, sixValue]\n'
    const narrow = await format(source, { lineLength: 40 })
    expect(narrow.split('\n').length).toBeGreaterThan(source.split('\n').length)
  })

  it('preserves comments', async () => {
    const out = await format('// leading\nstruct A{ /* inner */ }')
    expect(out).toMatch(/\/\/ leading/)
    expect(out).toMatch(/\/\* inner \*\//)
  })

  it('handles UTF-8 without corrupting bytes', async () => {
    const out = await format('let s="héllo wörld 🌍"')
    expect(out).toMatch(/héllo wörld 🌍/)
  })

  // swift-format's own default is 100 columns, and the package is the tool, so
  // formatting with no options has to mean what `swift-format format` means.
  it("defaults to swift-format's own configuration", async () => {
    const source = `let value = someFunction(firstArgument: 1, secondArgument: 2, thirdArgument: 3, fourth: 4)\n`
    expect(await format(source)).toBe(source)
  })

  it('applies individual rules', async () => {
    const source = 'import Foundation\nimport AppKit\nlet x = 1\n'
    const sorted = await format(source, { rules: { OrderedImports: true } })
    expect(sorted.indexOf('import AppKit')).toBeLessThan(sorted.indexOf('import Foundation'))
  })

  it('reuses one module across calls', async () => {
    const [a, b] = await Promise.all([format('struct A{}'), format('struct B{}')])
    expect(a).toBe('struct A {}\n')
    expect(b).toBe('struct B {}\n')
  })

  // Diagnostics are collected inside the module and handed back on stderr,
  // because a Swift error cannot cross the boundary as anything but a status.
  it('rejects invalid syntax with the parser diagnostic', async () => {
    expect(format('struct Broken {')).rejects.toThrow()
  })

  it('keeps formatting after a syntax error', async () => {
    await expect(format('struct Broken {')).rejects.toThrow()
    expect(await format('struct A{}')).toBe('struct A {}\n')
  })

  // swift-format leaves an empty file alone rather than emitting a newline.
  it('leaves empty input untouched', async () => {
    expect(await format('')).toBe('')
  })
})

describe('formatSync', () => {
  it('produces the same bytes as the async format', async () => {
    const source = 'struct P{var x:Int\nvar y:Int}'
    const expected = await format(source)
    expect(formatSync(source)).toBe(expected)
  })

  it('reports a parse failure rather than returning the source unchanged', async () => {
    await init()
    expect(() => formatSync('struct {{{ not swift')).toThrow()
  })

  it('stays usable after a failed format', async () => {
    await init()
    expect(() => formatSync('struct {{{ not swift')).toThrow()
    expect(formatSync('struct A{}')).toBe('struct A {}\n')
  })

  it('returns a string rather than a promise, which is the whole point', async () => {
    await init()
    const result = formatSync('struct A{}') as unknown
    expect(result).toBeString()
    expect(result).not.toHaveProperty('then')
  })
})
