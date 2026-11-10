// Verifies that the RuboCop pass produces byte-identical output to the real
// `rubocop` binary running the same correction natively.
//
// This is the whole of the evidence for the pass. It is rbcop - RuboCop 1.92.2
// reimplemented in Rust and compiled to wasm - and a reimplementation is exact
// only for as long as something keeps checking it against the tool it
// reimplements. So this asserts rather than reports: any divergence is a bug.
//
// The native side is the actual command-line tool - `rubocop --autocorrect
// --only Layout` over a directory of files - and nothing of ours: comparing
// rbcop with RuboCop is the point.
//
// Skipped unless a native ruby has the *pinned* gems installed. The pins are
// read from build/rbcop_fmt/Gemfile, which records the RuboCop that rbcop's own
// parity gates ran against, and every one of them is load-bearing: RuboCop's
// Layout output changes between releases, rubocop-ast decides which parser
// produces the token stream the Layout cops see, and the package's
// TargetRubyVersion puts RuboCop on Prism. CI installs them (see
// .github/workflows/ci.yml), so this runs there rather than quietly skipping.
//
// Set RUBY_FMT_CONFORMANCE_CORPUS to a directory of .rb files to run the same
// comparison over all of them as well. That is how the 300-file comparison in
// build/rbcop_fmt/SPIKE.md was made, and how to repeat it.

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { format } from '../src/index'
import { buildRuboCopConfig } from '../src/rubocop'
import { afterAll, describe, expect, it } from 'bun:test'

const here = path.dirname(fileURLToPath(import.meta.url))
const BUILD = path.join(here, '..', '..', '..', 'build')
const RUBY_GEMFILE = path.join(BUILD, 'ruby_fmt', 'Gemfile')
const ORACLE_GEMFILE = path.join(BUILD, 'rbcop_fmt', 'Gemfile')

/** A gem's pin as a Gemfile states it, which is the only version this package matches. */
const pinnedVersion = (gemfile: string, gem: string): string => {
  const match = fs.readFileSync(gemfile, 'utf8').match(new RegExp(`^gem "${gem}", "([^"]+)"$`, 'm'))
  if (!match?.[1]) throw new Error(`could not read the ${gem} pin from ${gemfile}`)
  return match[1]
}

/**
 * Whether a native ruby can activate this gem at exactly the pinned version.
 *
 * Asked as `gem "name", "version"` rather than by reading whatever `require`
 * happens to load, because that is also how the correction below is run - and
 * the difference is not academic. A machine with several RuboCops installed
 * resolves the bare `rubocop` binstub to the newest one, and RuboCop's Layout
 * output is not stable across releases. Pinning at activation is what makes
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

/** The oracle's gems, in the order they are activated. */
const ORACLE = ['rubocop', 'rubocop-ast', 'parser', 'prism'].map((gem) => ({
  gem,
  version: pinnedVersion(ORACLE_GEMFILE, gem),
}))
const pinnedSyntaxTree = pinnedVersion(RUBY_GEMFILE, 'syntax_tree')

const missing = [...ORACLE, { gem: 'syntax_tree', version: pinnedSyntaxTree }].find(
  ({ gem, version }) => !activates(gem, version),
)
const matchesPins = missing === undefined

/** Why this file ran or did not, reported in the test name so a skip is not silent. */
const reason = missing
  ? `${missing.gem} ${missing.version} is not installed`
  : ORACLE.map(({ gem, version }) => `${gem} ${version}`).join(', ')

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
 * The config written here is built by the very function the package uses for
 * the pass, called rather than retyped - if the two ever disagree about the
 * target Ruby version or which cops are off, that is exactly the divergence
 * this test should catch.
 */
const nativeRuboCopLayout = (sources: string[]): string[] => {
  fs.writeFileSync(path.join(workspace, '.rubocop.yml'), buildRuboCopConfig())

  const files = sources.map((source, index) => {
    const file = path.join(workspace, `sample_${String(index).padStart(3, '0')}.rb`)
    fs.writeFileSync(file, source)
    return file
  })

  // Driven through `RuboCop::CLI` under an explicit `gem` activation rather
  // than through the `rubocop` binstub, so that every version is the pinned
  // one. This is still the real command-line entry point - the same class the
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
      `${ORACLE.map(({ gem, version }) => `gem "${gem}", "${version}"`).join('\n')}
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
  // Two heredocs on one line, with arguments after them and interpolation in
  // one body: the token list arrives out of position order here, which is the
  // case a token-based Layout cop is likeliest to get wrong.
  'heredocs interleaving the token stream': `def render(name)
  template(<<~HTML,<<~CSS, name)
    <p>#{name}</p>
  HTML
    p { color: red }
  CSS
end
`,
  // An accented character ahead of the line the correction lands on, so that
  // byte offsets and character offsets disagree from there on. RuboCop works
  // in characters and rbcop in bytes; this is where a conversion would slip.
  'multi-byte characters ahead of a correction': `class Client
  LABEL = "café"
  attr_reader :base_url
  def to_s
    @base_url
  end
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
  // A chain that is itself the value of a hash pair, which RuboCop 1.84.1
  // learned to align. The second reaches the pair through a block's call rather
  // than its body.
  'a wrapped chain that is itself a hash value': `CONFIG = { value: some_receiver.method_one.method_two(argument_one, argument_two).method_three(argument_four) }
`,
  'a wrapped chain through a block call as a hash value': `CONFIG = { value: items.map do |i|
  i
end.select(&:present?).group_by(&:category).transform_values(&:count).sort }
`,
  // A regex literal on the left of `=~`, with the operand wrapped onto the next
  // line. Parser builds `match_with_lvasgn` for that rather than a `send`, so
  // Layout/MultilineOperationIndentation never sees it and RuboCop leaves the
  // operand where syntax_tree put it. rbcop 0.1.4 re-indented it - the one
  // divergence a 2,754-file corpus found, fixed in build/rbcop_fmt's patch - so
  // both shapes parser treats this way are pinned here: with named captures,
  // and without.
  'a wrapped operand of a regex literal match with named captures': `def parse(line)
  unless /^PRISM_EXPORTED_FUNCTION (?<return_type>.+) (?<name>\\w+)\\((?<arg_types>.+)\\);$/ =~ line_with_a_long_name_here
    raise "Could not parse"
  end
end
`,
  // The same without captures, on a multi-line extended regex, which is how the
  // corpus met it.
  'a wrapped operand of a regex literal match without captures': `def ascii_only?(str)
  /\\A [\\t\\n\\r\\x20-\\x7E]*
    (?:
      (?:\\x1b \\x28 I [\\x21-\\x7E]*
        |\\x1b \\x24 B (?:[\\x21-\\x7E]{2})*
      )*
      \\x1b \\x28 B [\\t\\n\\r\\x20-\\x7E]*
    )*
   \\z/nox =~ str.dup.force_encoding('BINARY') ? true : false
end
`,
  'already clean': `x = 1
`,
  // RuboCop 1.84.1 through 1.91 flattened a chain inside a block that is a hash
  // value against its receiver (rubocop/rubocop#15761), and this package used
  // to carry a patch for it. 1.92.2 has the fix, so these are no longer
  // divergences: both sides have to agree on them like everything else.
  'a chain inside a lambda that is a hash value': `CASES = [{ label: "all params", run: -> do
  client.beta.messages.batches.results_streaming("message_batch_id", {betas: ["beta"]}).each { |_event| break }
end }]
`,
  'a chain inside a proc block that is a hash value': `ROUTES = { index: proc { |request| request.params.fetch(:page).to_i.clamp(1, 100).then { |page| paginate(page) } } }
`,
  'a chain inside a begin that is a hash value': `CONFIG = { value: begin
  settings.fetch(:connection).fetch(:retries).fetch(:backoff).fetch(:multiplier)
end }
`,
}

/** The corpus named by RUBY_FMT_CONFORMANCE_CORPUS, if any: every .rb file under it. */
const corpusFiles = (): string[] => {
  const root = process.env['RUBY_FMT_CONFORMANCE_CORPUS']
  if (!root) return []
  return fs
    .readdirSync(root, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.rb'))
    .sort()
    .map((file) => path.join(root, file))
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

  const corpus = corpusFiles()

  it.skipIf(!matchesPins || corpus.length === 0)(
    `matches native rubocop over RUBY_FMT_CONFORMANCE_CORPUS (${corpus.length} files)`,
    async () => {
      // Both sides start from this package's own syntax_tree output, so that
      // what is compared is the RuboCop pass alone. Native syntax_tree is held
      // to the package's separately, in native-conformance.test.ts, and a file
      // that reaches one of stree-patch.ts's fixes would otherwise show up here
      // as a RuboCop divergence when it is nothing of the kind.
      const originals = corpus.map((file) => fs.readFileSync(file, 'utf8'))
      const reprinted: string[] = []
      for (const source of originals) reprinted.push(await format(source, { rubocop: false }))

      const expected = nativeRuboCopLayout(reprinted)
      const divergent: string[] = []

      for (const [index, source] of originals.entries()) {
        if ((await format(source, { rubocop: true })) !== expected[index]) divergent.push(corpus[index] ?? '')
      }

      expect(divergent).toEqual([])
    },
    1_800_000,
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
