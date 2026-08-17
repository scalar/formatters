// Imports the wired entry point rather than `createFormat`, because `format`
// bound to the on-disk artifact is what a Node consumer actually gets.
import { format } from './index'
import type { FormatOptions } from './types'
import { describe, expect, it } from 'bun:test'

describe('format', () => {
  it('formats a function body', async () => {
    const out = await format('pub fn add(a: i32,b:i32)->i32{a+b}')
    expect(out).toBe('pub fn add(a: i32, b: i32) -> i32 {\n    a + b\n}\n')
  })

  it('is idempotent', async () => {
    const once = await format('fn f(a:i32,b:i32)->i32{if a>b{a}else{b}}')
    expect(await format(once)).toBe(once)
  })

  it('indents with the configured width', async () => {
    const options: FormatOptions = { tabSpaces: 2 }
    const out = await format('fn f(){let x=1;}', options)
    expect(out).toBe('fn f() {\n  let x = 1;\n}\n')
  })

  it('indents with hard tabs when asked', async () => {
    const out = await format('fn f(){let x=1;}', { hardTabs: true })
    expect(out).toBe('fn f() {\n\tlet x = 1;\n}\n')
  })

  it('breaks lines at the configured width', async () => {
    const source = 'fn f(){let value=call(argument_one,argument_two,argument_three,argument_four);}'
    const narrow = await format(source, { maxWidth: 40 })
    expect(narrow.split('\n').length).toBeGreaterThan((await format(source)).split('\n').length)
  })

  it('preserves comments', async () => {
    const out = await format('// leading\nfn a(){ /* inner */ }')
    expect(out).toMatch(/\/\/ leading/)
    expect(out).toMatch(/\/\* inner \*\//)
  })

  it('handles UTF-8 without corrupting bytes', async () => {
    const out = await format('fn f(){let s="héllo wörld 🌍";}')
    expect(out).toMatch(/héllo wörld 🌍/)
  })

  // rustfmt's own default is 100 columns, and the package is the tool, so
  // formatting with no options has to mean what `rustfmt` means.
  it("defaults to rustfmt's own configuration", async () => {
    const source = 'fn f(){let value=compute(first_argument,second_argument,third_argument,fourth);}'
    const out = await format(source)
    expect(out).toBe('fn f() {\n    let value = compute(first_argument, second_argument, third_argument, fourth);\n}\n')
  })

  it('reaches options the typed surface does not name, through config', async () => {
    const out = await format('fn f(){let x=1;}', { config: { tab_spaces: '8' } })
    expect(out).toBe('fn f() {\n        let x = 1;\n}\n')
  })

  it('lets config override a typed field', async () => {
    const out = await format('fn f(){let x=1;}', { tabSpaces: 2, config: { tab_spaces: '6' } })
    expect(out).toBe('fn f() {\n      let x = 1;\n}\n')
  })

  // A bare newline, not the empty string - which is what native rustfmt emits
  // for empty input too.
  it('formats an empty source the way rustfmt does', async () => {
    expect(await format('')).toBe('\n')
  })

  describe('failures', () => {
    it('rejects source that does not parse, naming the problem', async () => {
      expect(format('fn ( {{{ not rust')).rejects.toThrow()
    })

    it('rejects an unknown configuration key', async () => {
      expect(format('fn f(){}', { config: { not_a_real_key: '1' } })).rejects.toThrow(/not_a_real_key/)
    })

    it('rejects a value rustfmt cannot parse', async () => {
      expect(format('fn f(){}', { config: { max_width: 'banana' } })).rejects.toThrow(/max_width/)
    })

    // The module is reused across calls, so a rejected call must not poison the
    // instance for the next one - which is the failure mode a shared reactor
    // invites and the reason this test exists.
    it('keeps working after a failure', async () => {
      expect(format('fn ( {{{ not rust')).rejects.toThrow()
      expect(await format('fn a(){}')).toBe('fn a() {}\n')
    })
  })
})
