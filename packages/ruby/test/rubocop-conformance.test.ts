// Verifies that the package produces byte-identical output to the real
// `rubocop --autocorrect --only Layout`.
//
// This is the whole of the evidence for the package. It is rbcop - RuboCop
// 1.92.2 reimplemented in Rust and compiled to wasm - and a reimplementation is
// exact only for as long as something keeps checking it against the tool it
// reimplements. So this asserts rather than reports: any divergence is a bug.
//
// The native side is the actual command-line tool over a directory of files,
// reading the same `.rubocop.yml` the package builds, and nothing of ours:
// comparing rbcop with RuboCop is the point. Both sides start from the same raw
// input, at RuboCop's default line length and at a narrower one, because
// `printWidth` turns Layout/LineLength's autocorrect on and that cop rewrites
// more than any other.
//
// Skipped unless a native ruby has the *pinned* gems installed. The pins are
// read from build/rbcop_fmt/Gemfile, which records the RuboCop that rbcop's own
// parity gates ran against, and every one of them is load-bearing: RuboCop's
// Layout output changes between releases, rubocop-ast decides which parser
// produces the token stream the Layout cops see, and the package's
// TargetRubyVersion puts RuboCop on Prism. CI installs them (see
// .github/workflows/ci.yml), so this runs there rather than quietly skipping.
//
// Set RUBY_FMT_CONFORMANCE_CORPUS to a directory of .rb and .rbi files to run
// the same comparison over all of them as well, at both widths. That is how the
// corpus comparisons in build/rbcop_fmt/SPIKE.md and the README were made, and
// how to repeat them.

import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { format } from '../src/index'
import { DEFAULT_PRINT_WIDTH, buildRuboCopConfig } from '../src/rubocop'
import type { FormatOptions } from '../src/types'
import { afterAll, describe, expect, it } from 'bun:test'

const here = path.dirname(fileURLToPath(import.meta.url))
const ORACLE_GEMFILE = path.join(here, '..', '..', '..', 'build', 'rbcop_fmt', 'Gemfile')

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
const missing = ORACLE.find(({ gem, version }) => !activates(gem, version))
const matchesPins = missing === undefined

/** Why this file ran or did not, reported in the test name so a skip is not silent. */
const reason = missing
  ? `${missing.gem} ${missing.version} is not installed`
  : ORACLE.map(({ gem, version }) => `${gem} ${version}`).join(', ')

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
 * target Ruby version or the line length, that is exactly the divergence this
 * test should catch.
 *
 * Every file is written under a `.rb` name, `.rbi` included, because RuboCop's
 * default `Include` does not list `.rbi` and would skip it. Only the contents
 * are compared.
 *
 * A file RuboCop gave up on - "Infinite loop detected", its own refusal to
 * settle - comes back as `undefined` rather than as whatever half-corrected
 * text it left on disk. The package rejects those instead of returning
 * anything, and that rejection is what such a file is compared against.
 */
const nativeRuboCopLayout = (sources: string[], options: FormatOptions = {}): (string | undefined)[] => {
  fs.rmSync(workspace, { recursive: true, force: true })
  fs.mkdirSync(workspace)
  fs.writeFileSync(path.join(workspace, '.rubocop.yml'), buildRuboCopConfig(options))

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
  const { stdout, stderr, error } = spawnSync(
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
    // The `quiet` formatter still lists every corrected offense, so the output
    // grows with the corpus; past ~2,000 files it overflows the 1MB default
    // and the native side dies with ENOBUFS.
    { encoding: 'utf8', stdio: 'pipe', maxBuffer: Number.POSITIVE_INFINITY },
  )
  if (error) throw error

  const gaveUp = new Set(
    [...`${stdout}\n${stderr}`.matchAll(/Infinite loop detected in (\S+) and caused by/g)].map((match) => match[1]),
  )

  return files.map((file) => (gaveUp.has(file) ? undefined : fs.readFileSync(file, 'utf8')))
}

/**
 * Sources chosen for where Layout corrections are hardest to get right.
 *
 * Over 397 files of real Ruby, 86% of the Layout offenses in already
 * line-structured code came from three cops: MultilineOperationIndentation,
 * MultilineMethodCallIndentation and FirstArgumentIndentation. A corpus of
 * ordinary-looking code would therefore pass this test while exercising almost
 * nothing, so these lean on the cases that bite. The long one-liners among them
 * are also what Layout/LineLength breaks.
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
  // operand where it was. rbcop 0.1.4 re-indented it - the one
  // divergence a 2,754-file corpus found, fixed in build/rbcop_fmt's patch - so
  // both shapes parser treats this way are pinned here, in LINE_STRUCTURED
  // below: with named captures, and without.
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
  // A `case/in` guard too long for one line, wrapped after the operator in
  // LINE_STRUCTURED below. Prism wraps the guard in an if/unless node and rbcop
  // took that for a keyword condition, aligning the operand with it; the parser
  // gem has an `unless_guard` there, so RuboCop indents it 2 from the `in`
  // line. Fixed in rbcop itself, upstream since costajohnt/rbcop#718.
  'a wrapped operand of a case/in guard': `case [content_type, body]
in [:jsonl, Enumerable] unless Very::Long::Namespace::Path::To::FileInput === body_with_a_long_name_here
  body
end
`,
  'already clean': `x = 1
`,
  // A guard clause with a statement after it on the same line. RuboCop skips
  // it when the two share a `begin` - every multi-statement body in parser's
  // AST - but a `begin ... end` without rescue holds its statements directly,
  // so there the guard is an offense, and the blank line it asks for is one
  // Layout/EmptyLinesAroundBeginBody removes: RuboCop reports an infinite loop
  // and, when the guard is the last statement before `end`, gives up. rbcop
  // skipped it everywhere and returned the file. The build patches that (see
  // build/rbcop_fmt/rbcop-wasm.patch); a 2,184-file corpus found it in the
  // standard library's time.rb. All four are pinned: the ordinary case, the
  // kwbegin case RuboCop corrects, the one it gives up on, and a rescue, which
  // puts a `begin` back around the statements.
  'a guard clause sharing its line with a statement': `def f
  return if a; b = 1
  c
end
`,
  'a guard clause sharing its line inside begin and end until': `begin
  break if a; b = 1
  c
end until true
`,
  'a guard clause sharing its line last inside begin and end until': `begin
  break if a; b = 1
end until true
`,
  'a guard clause sharing its line inside begin and rescue': `def f
  begin
    return if a; b = 1
    c
  rescue
    d
  end
end
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

/**
 * The samples above that have a long line, already broken over several lines -
 * the shape line-structured input arrives in, and where the Multiline*
 * indentation cops do their work. Generated once by the reprinter the package
 * used to run first, and kept as literal input now that it does not.
 */
const LINE_STRUCTURED: Record<string, string> = {
  'multiline boolean operation':
    'value =\n  some_long_receiver_name_here && another_condition_value ||\n    yet_another_condition_here\n',
  'multiline method chain':
    'result =\n  some_object\n    .method_one\n    .method_two(argument_one, argument_two)\n    .method_three(argument_four)\n',
  'wrapped first argument':
    'register_the_thing(\n  a_reasonably_long_argument,\n  another_long_argument,\n  and_a_third_one_here\n)\n',
  'heredocs interleaving the token stream':
    'def render(name)\n  template(<<~HTML, <<~CSS, name)\n    <p>#{name}</p>\n  HTML\n    p { color: red }\n  CSS\nend\n',
  'blocks and long conditions':
    'items\n  .select { |i| i.active? && i.visible? }\n  .map { |i| i.name }\n  .each_with_index do |name, index|\n    if name.length > 3 && index.even? && !name.start_with?("_")\n      puts "#{index}: #{name}"\n    end\n  end\n',
  'nested hash argument':
    'configure(\n  retries: 3,\n  backoff: 1.5,\n  on: [Timeout::Error, IOError],\n  logger: Logger.new($stdout)\n)\n',
  'a wrapped chain that is itself a hash value':
    'CONFIG = {\n  value:\n    some_receiver\n      .method_one\n      .method_two(argument_one, argument_two)\n      .method_three(argument_four)\n}\n',
  'a wrapped chain through a block call as a hash value':
    'CONFIG = {\n  value:\n    items\n      .map { |i| i }\n      .select(&:present?)\n      .group_by(&:category)\n      .transform_values(&:count)\n      .sort\n}\n',
  'a wrapped operand of a regex literal match with named captures':
    'def parse(line)\n  unless /^PRISM_EXPORTED_FUNCTION (?<return_type>.+) (?<name>\\w+)\\((?<arg_types>.+)\\);$/ =~\n           line_with_a_long_name_here\n    raise "Could not parse"\n  end\nend\n',
  'a wrapped operand of a regex literal match without captures':
    'def ascii_only?(str)\n  if /\\A [\\t\\n\\r\\x20-\\x7E]*\n    (?:\n      (?:\\x1b \\x28 I [\\x21-\\x7E]*\n        |\\x1b \\x24 B (?:[\\x21-\\x7E]{2})*\n      )*\n      \\x1b \\x28 B [\\t\\n\\r\\x20-\\x7E]*\n    )*\n   \\z/nox =~\n       str.dup.force_encoding("BINARY")\n    true\n  else\n    false\n  end\nend\n',
  'a wrapped operand of a case/in guard':
    'case [content_type, body]\nin [:jsonl, Enumerable] unless Very::Long::Namespace::Path::To::FileInput ===\n     body_with_a_long_name_here\n  body\nend\n',
  'a chain inside a lambda that is a hash value':
    'CASES = [\n  {\n    label: "all params",\n    run: -> do\n      client\n        .beta\n        .messages\n        .batches\n        .results_streaming("message_batch_id", { betas: ["beta"] })\n        .each { |_event| break }\n    end\n  }\n]\n',
  'a chain inside a proc block that is a hash value':
    'ROUTES = {\n  index:\n    proc do |request|\n      request\n        .params\n        .fetch(:page)\n        .to_i\n        .clamp(1, 100)\n        .then { |page| paginate(page) }\n    end\n}\n',
  'a chain inside a begin that is a hash value':
    'CONFIG = {\n  value:\n    begin\n      settings\n        .fetch(:connection)\n        .fetch(:retries)\n        .fetch(:backoff)\n        .fetch(:multiplier)\n    end\n}\n',
}

/** Lines only Layout/LineLength would touch, and the shapes its autocorrect cannot break. */
const LINE_LENGTH: Record<string, string> = {
  'a long call with hash arguments': `result = client.request(method: :get, path: "/v1/items", query: { page: 1, per_page: 100 }, headers: { "accept" => "json" })
`,
  'a long array literal': `ITEMS = [:first_item_name, :second_item_name, :third_item_name, :fourth_item_name, :fifth_item_name, :sixth]
`,
  'a long method definition': `def initialize(base_url:, api_key: nil, timeout: DEFAULT_TIMEOUT, max_retries: DEFAULT_MAX_RETRIES, idempotency_header: nil)
  @base_url = base_url
end
`,
  'a long lambda': `HANDLER = ->(request) { request.params.fetch(:page).to_i.clamp(1, 100).then { |page| paginate(page, request) } }
`,
  'a long constant assignment': `DEFAULT_CONNECTION_POOL_TIMEOUT_IN_SECONDS_FOR_ALL_OUTBOUND_REQUESTS = Configuration::Defaults::CONNECTION_TIMEOUT
`,
  'a long string literal': `MESSAGE = "${'x'.repeat(150)}"
`,
  'a long comment': `# ${'word '.repeat(40)}
x = 1
`,
}

/** A Sorbet .rbi, which is Ruby to RuboCop like anything else. */
const RBI = `# typed: strict
class Client
  extend T::Sig
  sig { params(base_url: String, token: T.nilable(String)).void }
  def initialize(base_url:, token: nil); end
  sig do
    params(
      path: String,
        query: T::Hash[Symbol, T.untyped]
    ).returns(T.untyped)
  end
  def get(path, query: {})
  end
    sig { returns(String) }
  def base_url; end
end
`

/** Every sample, keyed by a name that says which set it came from. */
const ALL: Record<string, string> = {
  ...SAMPLES,
  ...Object.fromEntries(Object.entries(LINE_STRUCTURED).map(([name, source]) => [`${name} (line-structured)`, source])),
  ...LINE_LENGTH,
  rbi: RBI,
}

/**
 * The widths everything is compared at: RuboCop's default, which is the
 * package's, and a narrower one, where Layout/LineLength rewrites far more.
 */
const WIDTHS = [DEFAULT_PRINT_WIDTH, 80]

/** The corpus named by RUBY_FMT_CONFORMANCE_CORPUS, if any: every .rb and .rbi file under it. */
const corpusFiles = (): string[] => {
  const root = process.env['RUBY_FMT_CONFORMANCE_CORPUS']
  if (!root) return []
  return fs
    .readdirSync(root, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.rb') || file.endsWith('.rbi'))
    .sort()
    .map((file) => path.join(root, file))
}

/** The names whose formatted output differs from what native RuboCop wrote. */
const divergences = async (names: string[], sources: string[], options: FormatOptions): Promise<string[]> => {
  const expected = nativeRuboCopLayout(sources, options)
  const divergent: string[] = []

  // One at a time rather than all at once, so a large corpus does not hold
  // every output in memory - and sequential is what a consumer does anyway.
  for (const [index, source] of sources.entries()) {
    const actual = await format(source, options).then(
      (output) => output,
      (error: unknown) => (String(error).includes('could not settle') ? undefined : `(rejected: ${String(error)})`),
    )
    if (actual !== expected[index]) divergent.push(names[index] ?? '')
  }

  return divergent
}

describe('rubocop-conformance', () => {
  const names = Object.keys(ALL)
  const sources = names.map((name) => ALL[name] ?? '')

  for (const printWidth of WIDTHS) {
    it.skipIf(!matchesPins)(
      `matches native rubocop byte for byte at printWidth ${printWidth} (${reason})`,
      async () => {
        // Compared as a whole rather than one assertion per sample, so a failure
        // report names every sample that diverged instead of only the first.
        expect(await divergences(names, sources, { printWidth })).toEqual([])
      },
      120_000,
    )
  }

  const corpus = corpusFiles()

  for (const printWidth of WIDTHS) {
    it.skipIf(!matchesPins || corpus.length === 0)(
      `matches native rubocop over RUBY_FMT_CONFORMANCE_CORPUS at printWidth ${printWidth} (${corpus.length} files)`,
      async () => {
        const originals = corpus.map((file) => fs.readFileSync(file, 'utf8'))

        expect(await divergences(corpus, originals, { printWidth })).toEqual([])
      },
      1_800_000,
    )
  }

  // The samples are only worth anything if RuboCop actually changes them.
  // Without this, a bug that quietly skipped the pass would still show both
  // sides agreeing - because both sides would be the input.
  it.skipIf(!matchesPins)(
    'exercises corrections rather than passing trivially',
    () => {
      for (const printWidth of WIDTHS) {
        const after = nativeRuboCopLayout(sources, { printWidth })
        const changed = after.filter((source, index) => source !== sources[index]).length

        // Fifteen of them change at the default width today. Ten leaves room to
        // add clean samples without leaving room for the pass to do nothing.
        expect(changed).toBeGreaterThan(10)
      }
    },
    120_000,
  )

  // The comparison above treats a file RuboCop gives up on as one the package
  // must reject. That path is only tested if a sample takes it.
  it.skipIf(!matchesPins)(
    'includes a sample RuboCop gives up on, which the package rejects',
    async () => {
      const source = SAMPLES['a guard clause sharing its line last inside begin and end until'] ?? ''

      expect(nativeRuboCopLayout([source])).toEqual([undefined])
      await expect(format(source)).rejects.toThrow(/could not settle.*Infinite loop detected/)
    },
    120_000,
  )

  // At the narrower width Layout/LineLength has to be doing work of its own,
  // or the second width is not testing anything the first did not.
  it.skipIf(!matchesPins)(
    'rewrites more at the narrower width',
    () => {
      const [wide, narrow] = WIDTHS.map((printWidth) => nativeRuboCopLayout(sources, { printWidth }))
      const differ = sources.filter((_, index) => wide?.[index] !== narrow?.[index]).length

      expect(differ).toBeGreaterThan(3)
    },
    120_000,
  )
})
