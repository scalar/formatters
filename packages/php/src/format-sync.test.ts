import { format } from './format'
import { formatSync } from './format-sync'
import { describe, expect, it } from 'bun:test'

const SAMPLE = `<?php
namespace App;
class   Payments {
public function charge(int $amount,string $currency="usd"){ return   [$amount,$currency]; }
}`

describe('format-sync', () => {
  it('returns a string rather than a promise', () => {
    const out = formatSync('<?php $a=1;')
    expect(typeof out).toBe('string')
    expect(out).toContain('$a = 1;')
  })

  // The reason to have both is that they are the same tool. If they can
  // disagree, a project that formats some files through one and some through
  // the other ends up with two styles, which is the problem this avoids.
  it('produces byte-identical output to format', async () => {
    expect(formatSync(SAMPLE)).toBe(await format(SAMPLE))
  })

  it('passes options through unchanged', async () => {
    const options = { indent: '  ', rules: '@PSR12' }
    expect(formatSync(SAMPLE, options)).toBe(await format(SAMPLE, options))
  })

  it('formats a batch in order with byte-identical output to format', async () => {
    const options = { indent: '  ' }
    const first = '<?php $first=1;'
    const second = '<?php $second=2;'
    const results = formatSync([first, second], options)

    expect(results).toHaveLength(2)
    expect(results[0]).toBe(await format(first, options))
    expect(results[1]).toBe(await format(second, options))
  })

  it('isolates a parse failure inside a batch', () => {
    const results = formatSync(['<?php $first=1;', '<?php class {{{', '<?php $third=3;'])

    expect(results[0]).toBe('<?php $first = 1;\n')
    expect(results[1]).toBeInstanceOf(SyntaxError)
    expect(results[2]).toBe('<?php $third = 3;\n')
  })

  it('returns an empty batch without failing', () => {
    expect(formatSync([])).toEqual([])
  })

  // The async API throws SyntaxError for a parse error, and the error has to
  // cross a thread boundary to get here - structured clone would have flattened
  // it to a plain Error.
  it('throws SyntaxError for invalid PHP, as format does', () => {
    expect(() => formatSync('<?php class {{{')).toThrow(SyntaxError)
  })

  it('carries the fixer’s message on a rejected rule', () => {
    expect(() => formatSync('<?php $a=1;', { rules: 'no_such_rule_exists' })).toThrow(/no_such_rule_exists/)
  })

  it('handles UTF-8 without corrupting bytes', () => {
    expect(formatSync('<?php $a="héllo wörld 🌍";')).toContain('héllo wörld 🌍')
  })

  // The result comes back through a fixed-size shared buffer, so anything
  // bigger than it has to grow the buffer and ask for the same result again
  // rather than truncating it or formatting twice.
  it('returns output larger than the shared buffer intact', () => {
    const filler = 'x'.repeat(1200)
    const source = `<?php\n${Array.from({ length: 900 }, (_, i) => `$v${i} = "${filler}";`).join('\n')}\n`

    const out = formatSync(source)

    expect(out.length).toBeGreaterThan(1024 * 1024)
    expect(out).toContain(`$v899 = "${filler}";`)
  })

  // One worker serves every call, so a later format has to be unaffected by an
  // earlier one - including by an earlier one that threw.
  it('stays usable across repeated calls and after a throw', () => {
    expect(formatSync('<?php $a=1;')).toContain('$a = 1;')
    expect(() => formatSync('<?php class {{{')).toThrow(SyntaxError)
    expect(formatSync('<?php $b=2;')).toContain('$b = 2;')
  })

  it('stays usable after a batch containing a failure', () => {
    expect(formatSync(['<?php class {{{', '<?php $a=1;'])[1]).toContain('$a = 1;')
    expect(formatSync('<?php $b=2;')).toContain('$b = 2;')
  })
})
