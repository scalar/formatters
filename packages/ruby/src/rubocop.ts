/**
 * The Ruby version RuboCop is told to target.
 *
 * It has to be stated rather than left to RuboCop, because RuboCop works it out
 * from its surroundings - a gemspec's `required_ruby_version`, a `.ruby-version`
 * file, the `TargetRubyVersion` key - and inside the VM there are no
 * surroundings, so it would fall back to its floor (2.7) and format for a Ruby
 * nobody is writing. Pinning it also makes the conformance test meaningful: the
 * native RuboCop it compares against reads this same config.
 */
const TARGET_RUBY_VERSION = 3.4

/**
 * The configuration this package gives RuboCop, before anything the caller adds.
 *
 * Deliberately tiny. Everything about which cops run and how they behave comes
 * from RuboCop's own `config/default.yml`, so what this produces is what stock
 * RuboCop produces. Only two things are stated, and both are here because the
 * default would be wrong rather than because we prefer something else:
 *
 * - `TargetRubyVersion`, which RuboCop cannot discover inside a VM.
 * - `Layout/LineLength`, which is **off**, because line width belongs to
 *   syntax_tree. syntax_tree reprints, so it is the tool that can actually
 *   honour `printWidth`; RuboCop only rebreaks what it is handed. With the cop
 *   on, the two disagreed whenever `printWidth` went above RuboCop's `Max: 120`
 *   default - `{ printWidth: 200 }` came back rewrapped at 124, which is
 *   neither width. Turning it off costs nothing measurable: over 397 files of
 *   real Ruby at the default width it changes none of them, and the 9 files
 *   with a line over 120 have one either way, because the cop's autocorrect
 *   could not fix them regardless.
 */
const BASE_CONFIG: Record<string, unknown> = {
  AllCops: { TargetRubyVersion: TARGET_RUBY_VERSION },
  'Layout/LineLength': { Enabled: false },
}

/**
 * The guest filename the default configuration is always written under.
 *
 * Fixed rather than generated because the boot snapshot has already parsed this
 * config and cached it against this path - see `configFileNames` in `format.ts`
 * for why a generated name would be unsafe here.
 */
export const DEFAULT_CONFIG_FILE_NAME = 'rubocop-default.yml'

/**
 * Builds the `.rubocop.yml` written into the guest, with a caller's overrides
 * merged over {@link BASE_CONFIG}.
 *
 * Emitted as JSON, which is valid YAML and which RuboCop's own loader reads
 * happily. That is not a shortcut: it is what makes an arbitrary caller-supplied
 * object safe to serialise, because JSON escaping is exact where hand-rolled
 * YAML quoting is a guess.
 *
 * Merging is one level deep, matching how a `.rubocop.yml` is read: a caller
 * naming `Layout/LineLength` replaces that whole entry rather than having its
 * keys folded into ours, which is what makes the cop above re-enablable.
 */
export const buildRuboCopConfig = (overrides: Record<string, unknown> = {}): string =>
  `${JSON.stringify({ ...BASE_CONFIG, ...overrides }, null, 2)}\n`

/**
 * Loads RuboCop into the VM and defines the Layout pass over it.
 *
 * Evaluated on the first call that needs RuboCop rather than at boot, because
 * requiring RuboCop costs about four seconds against syntax_tree's one, and a
 * caller who only ever passes `rubocop: false` should never pay it.
 *
 * ## What this is, and what it is not
 *
 * This is `rubocop --autocorrect --only Layout`, assembled from RuboCop's own
 * parts rather than reimplemented:
 *
 * - The cop set is `Registry.all` filtered by `Cop::Base.match?(["Layout"])`,
 *   which is line for line what `Runner#mobilized_cop_classes` does for
 *   `--only`.
 * - The options are the ones the CLI ends up holding for `-a`, per the table in
 *   `RuboCop::Options#add_autocorrection_options`: `autocorrect` and
 *   `safe_autocorrect` both true. That pairing is what keeps a cop marked
 *   `SafeAutoCorrect: false` from correcting, exactly as on the command line.
 * - Corrections come back through `@options[:stdin]`, which is RuboCop's own
 *   seam for correcting a source that is not a file on disk - the same one
 *   `--stdin` uses (see `Cop::Team#autocorrect`).
 * - The loop mirrors `Runner#iterate_until_no_changes`: correct, re-parse,
 *   correct again until nothing changes, bailing out on a repeated checksum or
 *   after 200 iterations. Corrections can introduce offenses, so a single pass
 *   is not enough, and two cops can undo one another forever, so an unbounded
 *   loop is not safe.
 *
 * What it is *not* is RuboCop's `Runner` itself, and the reason is worth
 * stating: `Runner` wants a target finder, a formatter set and a result cache
 * on disk, none of which mean anything for a single string in a VM. The pieces
 * below are the ones that decide the output; the pieces left out are the ones
 * that decide where output goes. `test/rubocop-conformance.test.ts` is what
 * holds that claim honest - it runs the same sources through `RuboCop::CLI`,
 * the real command-line entry point, and asserts byte-identical results. The
 * same comparison over 397 files of real Ruby found no divergence.
 */
export const RUBOCOP_SETUP = `
# RubyGems has no idea the bundle exists. rbwasm packages /bundle as a set of
# $LOAD_PATH entries and no specifications at all, so \`Gem::Specification\` sees
# only CRuby's default gems. That is invisible until a gem asserts a version of
# one of its dependencies - which prism's parser translation does the moment
# rubocop-ast requires it:
#
#     gem "parser", ">= 3.3.7.2"   # prism/translation/parser.rb
#
# With no spec to find that raises \`Gem::MissingSpecError\`, the rescue around it
# takes that for a LoadError, and it answers with \`exit(1)\` - which arrives here
# as a SystemExit thrown out of \`require "rubocop"\`, naming neither RubyGems nor
# the parser gem that is sitting right there on the load path.
#
# So give RubyGems a spec per packaged gem first. The list is read from
# /bundle/gems rather than written down on the JavaScript side, so it cannot
# drift from what the artifact actually carries, and it goes in Gem.user_dir,
# which is already on Gem.path (HOME is /work - see boot-vm.ts). The specs say
# nothing but name and version: they exist to answer a version assertion, and
# the code itself keeps loading from /bundle the way it already did.
require "fileutils"

bundle_specs = File.join(Gem.user_dir, "specifications")
FileUtils.mkdir_p(bundle_specs)

Dir.children("/bundle/gems").each do |entry|
  name, version = entry.match(/\\A(.+)-([^-]+)\\z/)&.captures
  next unless version && Gem::Version.correct?(version)

  File.write(File.join(bundle_specs, "#{entry}.gemspec"), <<~SPEC)
    Gem::Specification.new do |spec|
      spec.name = #{name.inspect}
      spec.version = #{version.inspect}
      spec.require_paths = ["lib"]
      spec.authors = ["-"]
      spec.summary = "-"
    end
  SPEC
end

Gem::Specification.reset

require "rubocop"

module ScalarRubyFmt
  # Raised when the correction loop cannot settle. Both shapes are RuboCop's
  # own \`InfiniteCorrectionLoop\` conditions, reported here in terms a
  # JavaScript caller can act on.
  class CorrectionLoop < StandardError
  end

  # \`rubocop --autocorrect --only Layout\`, in the option keys the CLI derives.
  BASE_OPTIONS = { autocorrect: true, safe_autocorrect: true, only: ["Layout"] }.freeze

  # RuboCop's own ceiling, from \`Runner::MAX_ITERATIONS\`. A file that has not
  # settled after 200 rounds is looping, not converging.
  MAX_ITERATIONS = 200

  class << self
    # Builds the cop set once, so that every later correction pays for it once.
    # Instantiating the Layout department is most of the per-call cost otherwise.
    def setup(work_dir)
      # RuboCop reads its config inside \`Dir.chdir(File.dirname(path)) { ... }\`,
      # so that ERB in a .rubocop.yml resolves relative paths the way a user
      # would expect. The block form chdirs *back* afterwards, and the VM starts
      # in "/", which is not a preopened directory and therefore does not exist
      # as far as WASI is concerned - so the restore raises ENOENT and config
      # loading dies before it has read a line. Standing in a real directory
      # first is the whole fix.
      Dir.chdir(work_dir)

      @configs = {}
      @registry = RuboCop::Cop::Registry.new(
        RuboCop::Cop::Registry.all.select { |cop| cop.match?(BASE_OPTIONS[:only]) },
        BASE_OPTIONS
      )
      nil
    end

    # The parsed config for one config file, built at most once per path.
    #
    # Cached because merging a config over RuboCop's default.yml costs about
    # half a second, and a caller formatting many files with the same options
    # should pay that once. Keyed by path, and the JavaScript side keeps one
    # path per distinct config, so a hit can never be a stale answer for
    # different settings.
    def config_for(config_path)
      @configs[config_path] ||= RuboCop::ConfigLoader.configuration_from_file(config_path)
    end

    # Corrects every Layout offense in \`source\` and returns the result.
    #
    # The path is what RuboCop reports offenses against and what a
    # \`# rubocop:disable\` directive is resolved relative to. Nothing is read
    # from or written to it - the source travels in and out through the
    # options hash.
    def correct(source, path, config_path)
      config = config_for(config_path)
      options = BASE_OPTIONS.merge(stdin: source)
      checksums = []
      iterations = 0

      loop do
        processed_source = process(options[:stdin], path, config)

        checksum = processed_source.checksum
        if checksums.include?(checksum)
          raise CorrectionLoop, "two Layout cops are undoing each other's corrections, so the " \\
                                "source would never settle - nothing was returned for it"
        end
        checksums << checksum

        iterations += 1
        if iterations > MAX_ITERATIONS
          raise CorrectionLoop, "the RuboCop pass was still making corrections after " \\
                                "#{MAX_ITERATIONS} rounds, so it was stopped"
        end

        team = RuboCop::Cop::Team.mobilize(@registry, config, options)
        team.investigate(processed_source)

        # Team writes the corrected source back into options[:stdin] and sets
        # this only when something actually changed, so it is both the loop's
        # exit condition and how the result gets out.
        break unless team.updated_source_file?
      end

      options[:stdin]
    end

    private

    # Mirrors \`Runner#get_processed_source\`, including the two assignments
    # after construction: cops reach for both, and leaving them unset changes
    # what \`# rubocop:disable\` comments do.
    def process(source, path, config)
      processed_source = RuboCop::ProcessedSource.new(
        source, config.target_ruby_version, path, parser_engine: config.parser_engine
      )
      processed_source.config = config
      processed_source.registry = @registry
      processed_source
    end
  end
end
`
