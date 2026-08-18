// Imports the wired entry point rather than `createFormat`, because `format`
// bound to the on-disk assets is what a Node consumer actually gets.
import { format, formatSync, init } from './index'
import type { FormatOptions } from './types'
import { describe, expect, it } from 'bun:test'

describe('format', () => {
  it('formats a class body', async () => {
    const out = await format('class A{int x  =  1;void F(){G( "hi" );}}')
    expect(out).toBe('class A\n{\n    int x = 1;\n\n    void F()\n    {\n        G("hi");\n    }\n}\n')
  })

  it('is idempotent', async () => {
    const once = await format('class A{void F(){int[] xs={1,2,3};}}')
    expect(await format(once)).toBe(once)
  })

  it('sorts using directives', async () => {
    const out = await format('using B;using A;class C{}')
    expect(out.startsWith('using A;\nusing B;\n')).toBe(true)
  })

  it('sorts a leading underscore ahead of letters, as a linguistic compare does', async () => {
    // Guards the ICU build. With InvariantGlobalization the comparison falls
    // back to ordinal and `_Word` lands after `MWord`, which is a silent
    // divergence from the real tool - see build/csharp_fmt/NOTES.md.
    const out = await format('using N.MWord;using N.ZWord;using N._Word;class C{}')
    expect(out).toBe('using N._Word;\nusing N.MWord;\nusing N.ZWord;\n\nclass C { }\n')
  })

  it('indents with tabs when asked', async () => {
    const options: FormatOptions = { useTabs: true }
    const out = await format('class A{void F(){int x=1;}}', options)
    expect(out).toBe('class A\n{\n\tvoid F()\n\t{\n\t\tint x = 1;\n\t}\n}\n')
  })

  it('honours indentSize', async () => {
    const out = await format('class A{void F(){}}', { indentSize: 2 })
    expect(out).toBe('class A\n{\n  void F() { }\n}\n')
  })

  it('breaks at printWidth', async () => {
    const source = 'class A{void F(){SomeMethod(argumentOne,argumentTwo,argumentThree);}}'
    const narrow = await format(source, { printWidth: 40 })
    const wide = await format(source, { printWidth: 200 })
    expect(narrow.split('\n').length).toBeGreaterThan(wide.split('\n').length)
  })

  it('emits crlf when asked', async () => {
    const out = await format('class A{}', { endOfLine: 'crlf' })
    expect(out).toBe('class A { }\r\n')
  })

  it('preserves comments', async () => {
    const out = await format('// leading\nclass A{ /* inner */ }')
    expect(out).toMatch(/\/\/ leading/)
    expect(out).toMatch(/\/\* inner \*\//)
  })

  it('preserves a byte-order mark, the way the CLI does', async () => {
    const out = await format('﻿class  A{}')
    expect(out).toBe('﻿class A { }\n')
  })

  it('does not invent a byte-order mark', async () => {
    const out = await format('class  A{}')
    expect(out.startsWith('﻿')).toBe(false)
  })

  it('handles UTF-8 without corrupting bytes', async () => {
    const out = await format('class A{string s="héllo wörld 🌍";}')
    expect(out).toMatch(/héllo wörld 🌍/)
  })

  it('formats modern syntax', async () => {
    const out = await format('record  Point(int  X,int  Y);')
    expect(out).toBe('record Point(int X, int Y);\n')
  })

  it('throws the diagnostics CSharpier produced for source that does not parse', async () => {
    expect(format('class A{')).rejects.toThrow(/CS1513/)
  })

  it('reuses one module across calls', async () => {
    const [a, b] = await Promise.all([format('class A{}'), format('class B{}')])
    expect(a).toBe('class A { }\n')
    expect(b).toBe('class B { }\n')
  })
})

describe('formatSync', () => {
  it('produces the same bytes as the async format', async () => {
    const source = 'class A{int x=1;}'
    const expected = await format(source)
    expect(formatSync(source)).toBe(expected)
  })

  it('reports a parse failure rather than returning the source unchanged', async () => {
    await init()
    expect(() => formatSync('class A{')).toThrow()
  })

  it('stays usable after a failed format', async () => {
    await init()
    expect(() => formatSync('class A{')).toThrow()
    expect(formatSync('class A{int x=1;}')).toBe('class A\n{\n    int x = 1;\n}\n')
  })

  it('returns a string rather than a promise, which is the whole point', async () => {
    await init()
    const result = formatSync('class A{int x=1;}') as unknown
    expect(result).toBeString()
    expect(result).not.toHaveProperty('then')
  })
})
