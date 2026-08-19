// Verifies that the RuboCop pass running on CRuby/wasm produces byte-identical
// output to the real `rubocop` binary running the same correction natively.
//
// This one asserts rather than reports: the package IS RuboCop, so any
// divergence is a bug in how this package drives it, not a known stylistic gap.
//
// The native side is the actual command-line tool - `rubocop --autocorrect
// --only Layout` over a directory of files - and that is the whole point.
// `src/rubocop.ts` assembles the correction from RuboCop's own parts rather
// than going through `RuboCop::Runner`, so a native check that reused the same
// assembly would be comparing our code to our code and would prove nothing.
// Shelling out to the binary is what makes this evidence.
//
// Skipped unless a native ruby has the *pinned* rubocop and rubocop-ast
// installed. Both versions are load-bearing: RuboCop's Layout output changes
// between releases, and rubocop-ast decides which parser produces the token
// stream the Layout cops see. The pins are read from the Gemfile the artifact
// is built from rather than duplicated here, which is what keeps the native
// side and the wasm side from drifting apart. CI installs them (see
// .github/workflows/ci.yml), so this runs there rather than quietly skipping.

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { format } from '../src/index'
import { RUBOCOP_CONFIG_YAML } from '../src/rubocop'
import { afterAll, describe, expect, it } from 'bun:test'

const here = path.dirname(fileURLToPath(import.meta.url))
const GEMFILE = path.join(here, '..', '..', '..', 'build', 'ruby_fmt', 'Gemfile')

/** A gem's pin as the Gemfile states it, which is the only version this package matches. */
const pinnedVersion = (gem: string): string => {
  const match = fs.readFileSync(GEMFILE, 'utf8').match(new RegExp(`^gem "${gem}", "([^"]+)"$`, 'm'))
  if (!match?.[1]) throw new Error(`could not read the ${gem} pin from ${GEMFILE}`)
  return match[1]
}

/**
 * Whether a native ruby can activate this gem at exactly the pinned version.
 *
 * Asked as `gem "name", "version"` rather than by reading whatever `require`
 * happens to load, because that is also how the correction below is run - and
 * the difference is not academic. A machine with several RuboCops installed
 * resolves the bare `rubocop` binstub to the newest one, and RuboCop's Layout
 * output is not stable across releases: 1.89 indents a wrapped method chain
 * differently from 1.74 on the same input. Pinning at activation is what makes
 * "byte-identical" a claim about a known version rather than about whichever
 * one happened to be installed.
 */
const activates = (gem: string, version: string): boolean => {
  try {
    execFileSync('ruby', ['-e', `gem "${gem}", "${version}"`], { encoding: 'utf8', stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

const pinnedRuboCop = pinnedVersion('rubocop')
const pinnedRuboCopAst = pinnedVersion('rubocop-ast')
const pinnedSyntaxTree = pinnedVersion('syntax_tree')

const hasRuboCop = activates('rubocop', pinnedRuboCop)
const hasRuboCopAst = activates('rubocop-ast', pinnedRuboCopAst)
const hasSyntaxTree = activates('syntax_tree', pinnedSyntaxTree)
const matchesPins = hasRuboCop && hasRuboCopAst && hasSyntaxTree

/** Why this file ran or did not, reported in the test name so a skip is not silent. */
const describeGems = (): string => {
  if (!hasRuboCop) return `rubocop ${pinnedRuboCop} is not installed`
  if (!hasRuboCopAst) return `rubocop-ast ${pinnedRuboCopAst} is not installed`
  if (!hasSyntaxTree) return `syntax_tree ${pinnedSyntaxTree} is not installed`
  return `rubocop ${pinnedRuboCop} with rubocop-ast ${pinnedRuboCopAst}`
}

const reason = describeGems()

// syntax_tree runs first on both sides, and it runs natively here for the same
// reason the whole native side exists - so that what the wasm build produces is
// compared against something it did not produce itself.
//
// -EUTF-8 because the default external encoding is US-ASCII when no locale is
// set, which makes any non-ASCII sample blow up on the native side only.
const SYNTAX_TREE_SCRIPT = `
  gem "syntax_tree", "${pinnedSyntaxTree}"
  require "syntax_tree"
  require "json"
  print JSON.generate(JSON.parse($stdin.read).map { |src| SyntaxTree.format(src) })
`

const nativeSyntaxTree = (sources: string[]): string[] =>
  JSON.parse(
    execFileSync('ruby', ['-EUTF-8', '-e', SYNTAX_TREE_SCRIPT], {
      input: JSON.stringify(sources),
      encoding: 'utf8',
    }),
  )

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'ruby-fmt-rubocop-'))

afterAll(() => {
  fs.rmSync(workspace, { recursive: true, force: true })
})

/**
 * Runs the real `rubocop --autocorrect --only Layout` over every source at once
 * and hands the corrected files back in the order they went in.
 *
 * One invocation for all of them rather than one each: booting ruby and loading
 * RuboCop costs far more than correcting does, and RuboCop corrects each file
 * independently, so batching changes nothing but the wall clock.
 *
 * The config written here is the very string the package writes into the guest,
 * imported rather than retyped - if the two ever disagree about the target Ruby
 * version, that is exactly the divergence this test should catch.
 */
const nativeRuboCopLayout = (sources: string[]): string[] => {
  fs.writeFileSync(path.join(workspace, '.rubocop.yml'), RUBOCOP_CONFIG_YAML)

  const files = sources.map((source, index) => {
    const file = path.join(workspace, `sample_${String(index).padStart(3, '0')}.rb`)
    fs.writeFileSync(file, source)
    return file
  })

  // Driven through `RuboCop::CLI` under an explicit `gem` activation rather
  // than through the `rubocop` binstub, so that both versions are the pinned
  // ones. This is still the real command-line entry point - the same class the
  // binstub calls, given the same argv - just with the gem versions nailed down
  // rather than left to whatever is newest on the machine.
  //
  // Caching is off because the cache is keyed on options and content, and a
  // hit would hand back a previous run's answer instead of doing the work.
  //
  // `run` returns a non-zero status when it finds offenses, which is the normal
  // case here, so the status is ignored. A real failure shows up as output that
  // does not match.
  execFileSync(
    'ruby',
    [
      '-e',
      `gem "rubocop", "${pinnedRuboCop}"
       gem "rubocop-ast", "${pinnedRuboCopAst}"
       require "rubocop"
       RuboCop::CLI.new.run(ARGV)`,
      '--',
      '--autocorrect',
      '--only',
      'Layout',
      '--no-color',
      '--format',
      'quiet',
      '--cache',
      'false',
      workspace,
    ],
    { encoding: 'utf8', stdio: 'pipe' },
  )

  return files.map((file) => fs.readFileSync(file, 'utf8'))
}

/**
 * Sources chosen for where syntax_tree and RuboCop actually disagree.
 *
 * Measured over 397 files of real Ruby, 70% of syntax_tree's output is already
 * clean under stock `rubocop --only Layout`, and 86% of what is left comes from
 * three cops: MultilineOperationIndentation, MultilineMethodCallIndentation and
 * FirstArgumentIndentation. A corpus of ordinary-looking code would therefore
 * pass this test while exercising almost nothing, so these lean on the cases
 * that bite.
 */
const SAMPLES: Record<string, string> = {
  'multiline boolean operation': `value = some_long_receiver_name_here && another_condition_value || yet_another_condition_here
`,
  'multiline method chain': `result = some_object.method_one.method_two(argument_one, argument_two).method_three(argument_four)
`,
  'wrapped first argument': `register_the_thing(a_reasonably_long_argument, another_long_argument, and_a_third_one_here)
`,
  'attribute accessor then method': `class Client
  attr_reader :base_url
  def initialize(base_url)
    @base_url = base_url
  end
  def to_s
    @base_url
  end
end
`,
  'guard clause': `def call(user)
  return unless user
  user.name
end
`,
  heredoc: `def usage
  puts <<~TEXT
    Usage: client [options]
      -v  verbose
  TEXT
end
`,
  'client class': `# frozen_string_literal: true
require "json"
module Scalar
  class Client
    DEFAULT_TIMEOUT = 30
    def initialize(base_url:, token: nil, timeout: DEFAULT_TIMEOUT)
      @base_url = base_url
      @token = token
      @timeout = timeout
    end
    def get(path, params = {})
      uri = URI.join(@base_url, path)
      uri.query = URI.encode_www_form(params) unless params.empty?
      JSON.parse(Net::HTTP.get_response(uri).body, symbolize_names: true)
    end
  end
end
`,
  'blocks and long conditions': `items.select { |i| i.active? && i.visible? }.map { |i| i.name }.each_with_index do |name, index|
  puts "#{index}: #{name}" if name.length > 3 && index.even? && !name.start_with?("_")
end
`,
  'nested hash argument': `configure(retries: 3, backoff: 1.5, on: [Timeout::Error, IOError], logger: Logger.new($stdout))
`,
  'already clean': `x = 1
`,
}

describe('rubocop-conformance', () => {
  const names = Object.keys(SAMPLES)
  const sources = names.map((name) => SAMPLES[name] ?? '')

  it.skipIf(!matchesPins)(
    `matches native rubocop byte for byte (${reason})`,
    async () => {
      const expected = nativeRuboCopLayout(nativeSyntaxTree(sources))
      const actual = await Promise.all(sources.map((source) => format(source, { rubocop: true })))

      // Compared as a whole rather than one assertion per sample, so a failure
      // report names every sample that diverged instead of only the first.
      const divergent = names.filter((_, index) => actual[index] !== expected[index])
      expect(divergent).toEqual([])
    },
    120_000,
  )

  // The corpus is only worth anything if RuboCop actually changes something in
  // it. Without this, a bug that quietly skipped the pass entirely would still
  // show both sides agreeing - because both sides would be plain syntax_tree.
  it.skipIf(!matchesPins)(
    'exercises corrections rather than passing trivially',
    async () => {
      const before = nativeSyntaxTree(sources)
      const after = nativeRuboCopLayout(before)

      expect(after.filter((source, index) => source !== before[index]).length).toBeGreaterThan(2)
    },
    120_000,
  )
})
