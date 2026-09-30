// The patch in rubocop-patch.ts stops `Layout/MultilineMethodCallIndentation`
// from treating a chain inside a block as the value of the hash pair the block
// is nested in. These check the patch is live and still matches the gem it was
// written against; format.test.ts checks what it does to real input, and
// test/rubocop-conformance.test.ts checks that the real `rubocop` binary still
// gets that input wrong and that we differ from it nowhere else.

import { format, init } from './index'
import { nodeVm } from './node-vm'
import { DERIVED_FROM_RUBOCOP } from './rubocop-patch'
import { beforeAll, describe, expect, it } from 'bun:test'

/** Generous for the same reason format.test.ts's is: this boots the artifact. */
const WARMUP_TIMEOUT_MS = 120_000

beforeAll(async () => {
  await init()
}, WARMUP_TIMEOUT_MS)

describe('rubocop-patch', () => {
  // The retirement signal. The patch is a copy of one private method, and a
  // newer RuboCop would not fail anything on its own - the copy would keep
  // overriding whatever upstream wrote. So the version is asserted directly:
  // bump the pin in build/ruby_fmt/Gemfile, rebuild the artifact, and this is
  // what tells you the copy has to be re-derived or dropped.
  it('still runs the rubocop the patch was derived from', async () => {
    const { vm } = await nodeVm.boot()

    expect(vm.eval('RuboCop::Version::STRING').toString()).toBe(DERIVED_FROM_RUBOCOP)
  })

  // A patch that reopened the wrong class, or one that was never evaluated,
  // would leave the gem's copy in place and this would say so. The gem's copy
  // lives under /bundle in the guest; a patch is evaluated from a string.
  it('is the method the cop calls', async () => {
    const { vm } = await nodeVm.boot()

    const location = vm
      .eval(
        'RuboCop::Cop::Layout::MultilineMethodCallIndentation.instance_method(:find_pair_ancestor).source_location.first',
      )
      .toString()

    expect(location.startsWith('/bundle/')).toBe(false)
  })

  // The walk stops at every body the patch covers, not only a lambda's. Each of
  // these leaves the continuation where syntax_tree put it: two spaces in from
  // the receiver.
  it.each([
    ['a do block', 'X = { a: foo do\n  client.one.two.three.four\nend }\n'],
    ['a brace block', 'X = { a: foo { client.one.two.three.four } }\n'],
    ['a lambda', 'X = { a: -> { client.one.two.three.four } }\n'],
    ['a begin', 'X = { a: begin\n  client.one.two.three.four\nend }\n'],
    ['an if', 'X = { a: if ok\n  client.one.two.three.four\nend }\n'],
    ['an else', 'X = { a: if ok\n  1\nelse\n  client.one.two.three.four\nend }\n'],
    ['a while', 'X = { a: while ok\n  client.one.two.three.four\nend }\n'],
    ['a for', 'X = { a: for i in y\n  client.one.two.three.four\nend }\n'],
    ['a rescue', 'X = { a: begin\n  1\nrescue\n  client.one.two.three.four\nend }\n'],
  ])('keeps the chain indented inside %s', async (_, source) => {
    const out = await format(source, { printWidth: 20 })

    expect(out).toMatch(/^( +)client\n\1 {2}\.one\n\1 {2}\.two$/m)
  })
})
