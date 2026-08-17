// Verifies that syntax_tree running on CRuby/wasm produces byte-identical
// output to the same gem running on a native Ruby.
//
// This one asserts rather than reports: the package IS syntax_tree, so any
// divergence is a real bug (a Ripper difference between Ruby versions, or a
// broken vendored copy), not a known stylistic gap.
//
// Skipped unless a native ruby has the *pinned* syntax_tree installed. The
// version is load-bearing: syntax_tree's output changes between releases, so a
// comparison against some other version fails for a reason that has nothing to
// do with this package. The pin is read from the Gemfile the artifact is built
// from rather than duplicated here, which is what keeps the native side and the
// wasm side from drifting apart. CI installs it (see .github/workflows/ci.yml),
// so this runs there rather than quietly skipping - a conformance test nobody
// runs is not evidence of anything.
//
// All the samples go through a single native ruby, not one per sample. Booting
// ruby and requiring syntax_tree costs far more than formatting does, and doing
// it per sample made this test slow enough to intermittently exceed its timeout
// under load - surfacing as a SIGTERM'd `ruby` child with empty stderr, which
// reads like a Ruby crash rather than the timeout it actually was.

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { format } from '../src/index'
import { describe, expect, it } from 'bun:test'

const here = path.dirname(fileURLToPath(import.meta.url))
const GEMFILE = path.join(here, '..', '..', '..', 'build', 'ruby_fmt', 'Gemfile')

/** The syntax_tree the artifact is built from, which is the only one it matches. */
const pinnedVersion = (): string => {
  const match = fs.readFileSync(GEMFILE, 'utf8').match(/^gem "syntax_tree", "([^"]+)"$/m)
  if (!match?.[1]) throw new Error(`could not read the syntax_tree pin from ${GEMFILE}`)
  return match[1]
}

/** The syntax_tree a native ruby would load, or undefined if there is not one. */
const nativeVersion = (): string | undefined => {
  try {
    return execFileSync('ruby', ['-e', 'require "syntax_tree"; print SyntaxTree::VERSION'], {
      encoding: 'utf8',
    }).trim()
  } catch {
    return undefined
  }
}

const nativeGem = nativeVersion()
const matchesPin = nativeGem === pinnedVersion()

/** Why this file ran or did not, reported in the test name so a skip is not silent. */
const describeGem = (): string => {
  if (!nativeGem) return 'syntax_tree is not installed'
  if (!matchesPin) return `native syntax_tree ${nativeGem} is not the pinned ${pinnedVersion()}`
  return `syntax_tree ${nativeGem}`
}

const reason = describeGem()

// -EUTF-8 because the default external encoding is US-ASCII when no locale is
// set, which makes any non-ASCII sample blow up on the native side only.
//
// JSON in and JSON out keeps sources and results paired without needing a
// delimiter that cannot appear in Ruby source.
const RUBY_SCRIPT = `
  require "syntax_tree"
  require "json"
  print JSON.generate(JSON.parse($stdin.read).map { |src| SyntaxTree.format(src) })
`

const nativeAll = (sources: string[]): string[] =>
  JSON.parse(
    execFileSync('ruby', ['-EUTF-8', '-e', RUBY_SCRIPT], {
      input: JSON.stringify(sources),
      encoding: 'utf8',
    }),
  )

const SAMPLES: Record<string, string> = {
  'client class': `# frozen_string_literal: true
require "json"
module Scalar
  class Client
    DEFAULT_TIMEOUT=30
    attr_reader :base_url
    def initialize(base_url:, token: nil, timeout: DEFAULT_TIMEOUT)
      @base_url=base_url; @token=token; @timeout=timeout
    end
    def list_users(page: 1, per_page: 25, filter: {})
      get("/users", query: { page: page, per_page: per_page }.merge(filter))
    end
  end
end`,
  'endless methods': `class Config
  OPTIONS = { retries: 3, backoff: 1.5 }.freeze
  def self.build(**overrides) = new(**OPTIONS.merge(overrides))
  def to_h = { retries: @retries, backoff: @backoff }
end`,
  'case/in': `def code(resp)
  case resp.status
  when 200..299 then JSON.parse(resp.body, symbolize_names: true)
  when 404 then raise NotFoundError, resp.path
  else raise ApiError.new(resp.status, resp.body)
  end
end`,
  'blocks and procs': `items.filter { |i| i.active? }.map { |i| i.name }.sort_by(&:downcase).each_with_index do |name, index|
  puts "#{index}: #{name}"
end`,
  heredoc: `def usage
  puts <<~TEXT
    Usage: client [options]
      -v  verbose
  TEXT
end`,
}

/**
 * The one input where this package deliberately differs from the gem it ships:
 * stock syntax_tree 6.3.0 drops the mandatory `then` and returns source Ruby
 * cannot parse, and we keep it (see src/stree-patch.ts).
 *
 * Asserting that the native side is still broken is the point of the test.
 * Whenever syntax_tree releases the fix, native output starts parsing, this
 * fails, and the patch has done its job and can go.
 */
const ENDLESS_RANGE_PATTERN = 'case s\nin 300.. | 400.. then\n  a\nend\n'

const RUBY_PARSES_SCRIPT = `
  require "ripper"
  print Ripper.sexp($stdin.read).nil? ? "no" : "yes"
`

const nativeParses = (source: string): boolean =>
  execFileSync('ruby', ['-EUTF-8', '-e', RUBY_PARSES_SCRIPT], { input: source, encoding: 'utf8' }) === 'yes'

describe('native-conformance', () => {
  it.skipIf(!matchesPin)(`matches native syntax_tree byte for byte (${reason})`, async () => {
    const samples = Object.entries(SAMPLES)
    const native = nativeAll(samples.map(([, source]) => source))

    // Pair each sample with its native result up front. The empty-string
    // fallback can only be hit if native ruby returned fewer results than we
    // sent, which no real formatting run matches - so it fails loudly here
    // rather than being silently skipped.
    const expectations = samples.map(([name, source], index) => ({ name, source, expected: native[index] ?? '' }))

    for (const { name, source, expected } of expectations) {
      expect(await format(source), `diverged on: ${name}`).toBe(expected)
    }
  })

  it.skipIf(!matchesPin)('diverges from native only where native emits unparseable Ruby', async () => {
    const [native] = nativeAll([ENDLESS_RANGE_PATTERN])
    expect(nativeParses(native ?? '')).toBe(false)

    const ours = await format(ENDLESS_RANGE_PATTERN)
    expect(ours).not.toBe(native)
    expect(nativeParses(ours)).toBe(true)
  })
})
