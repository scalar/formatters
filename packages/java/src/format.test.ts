// Imports the wired entry point rather than `createFormat`, because `format`
// bound to the on-disk artifact is what a Node consumer actually gets.
import { format } from './index'
import type { FormatOptions } from './types'
import { describe, expect, it } from 'bun:test'

describe('format', () => {
  it('formats a class body', async () => {
    const out = await format('class A{int x  =  1;void f(){g( "hi" );}}')
    expect(out).toBe('class A {\n  int x = 1;\n\n  void f() {\n    g("hi");\n  }\n}\n')
  })

  it('is idempotent', async () => {
    const once = await format('class A{void f(){int[] xs={1,2,3};}}')
    expect(await format(once)).toBe(once)
  })

  it('indents with four spaces in aosp style', async () => {
    const options: FormatOptions = { style: 'aosp' }
    const out = await format('class A{void f(){int x=1;}}', options)
    expect(out).toBe('class A {\n    void f() {\n        int x = 1;\n    }\n}\n')
  })

  it('preserves comments', async () => {
    const out = await format('// leading\nclass A{ /* inner */ }')
    expect(out).toMatch(/\/\/ leading/)
    expect(out).toMatch(/\/\* inner \*\//)
  })

  it('reflows javadoc', async () => {
    const out = await format('/**\n*   Does a thing.\n*/\nclass A{}')
    expect(out).toBe('/** Does a thing. */\nclass A {}\n')
  })

  it('handles UTF-8 without corrupting bytes', async () => {
    const out = await format('class A{String s="héllo wörld 🌍";}')
    expect(out).toMatch(/héllo wörld 🌍/)
  })

  it('reuses one module across calls', async () => {
    const [a, b] = await Promise.all([format('class A{}'), format('class B{}')])
    expect(a).toBe('class A {}\n')
    expect(b).toBe('class B {}\n')
  })

  // A Java exception reaches JavaScript as a Java proxy with no readable
  // message, so failures are encoded in the result rather than thrown across
  // the boundary. This asserts the diagnostic survives that encoding.
  it('rejects invalid syntax with the compiler diagnostic', async () => {
    expect(format('class Broken {')).rejects.toThrow(/error/)
  })

  it('keeps formatting after a syntax error', async () => {
    await expect(format('class Broken {')).rejects.toThrow()
    expect(await format('class A{}')).toBe('class A {}\n')
  })
})
