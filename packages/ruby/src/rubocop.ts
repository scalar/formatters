/**
 * The Ruby version RuboCop is told to target, and the only thing this package's
 * `.rubocop.yml` says.
 *
 * It has to be stated rather than left to RuboCop, because RuboCop works it out
 * from its surroundings - a gemspec's `required_ruby_version`, a `.ruby-version`
 * file, the `TargetRubyVersion` key - and inside the VM there are no
 * surroundings, so it would fall back to its floor (2.7) and format for a Ruby
 * nobody is writing. Pinning it also makes the conformance test meaningful: the
 * native RuboCop it compares against reads this same file.
 */
const TARGET_RUBY_VERSION = '3.4'

/**
 * The configuration written into the guest before RuboCop is set up.
 *
 * Deliberately almost empty. Everything about which cops run and how they
 * behave comes from RuboCop's own `config/default.yml`, so what this package
 * produces is what stock RuboCop produces - the one thing stated here is the
 * one thing RuboCop cannot discover for itself.
 */
export const RUBOCOP_CONFIG_YAML = `AllCops:
  TargetRubyVersion: ${TARGET_RUBY_VERSION}
`

/** Where {@link RUBOCOP_CONFIG_YAML} is written in the guest filesystem. */
export const RUBOCOP_CONFIG_PATH = '.rubocop.yml'

/**
 * Loads RuboCop into the VM and defines the Layout pass over it.
 *
 * Evaluated lazily - on the first `format` that asks for RuboCop, not at boot -
 * because requiring RuboCop costs about four seconds against syntax_tree's one,
 * and a caller who never passes `rubocop: true` should never pay it.
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
    # Builds the config and the cop set once, so that every later correction
    # pays for neither. Parsing default.yml and instantiating the Layout
    # department is the bulk of the per-call cost otherwise.
    def setup(config_path)
      # RuboCop reads its config inside \`Dir.chdir(File.dirname(path)) { ... }\`,
      # so that ERB in a .rubocop.yml resolves relative paths the way a user
      # would expect. The block form chdirs *back* afterwards, and the VM starts
      # in "/", which is not a preopened directory and therefore does not exist
      # as far as WASI is concerned - so the restore raises ENOENT and config
      # loading dies before it has read a line. Standing in a real directory
      # first is the whole fix.
      Dir.chdir(File.dirname(config_path))

      @config = RuboCop::ConfigLoader.configuration_from_file(config_path)
      @registry = RuboCop::Cop::Registry.new(
        RuboCop::Cop::Registry.all.select { |cop| cop.match?(BASE_OPTIONS[:only]) },
        BASE_OPTIONS
      )
      nil
    end

    # Corrects every Layout offense in \`source\` and returns the result.
    #
    # The path is what RuboCop reports offenses against and what a
    # \`# rubocop:disable\` directive is resolved relative to. Nothing is read
    # from or written to it - the source travels in and out through the
    # options hash.
    def correct(source, path)
      options = BASE_OPTIONS.merge(stdin: source)
      checksums = []
      iterations = 0

      loop do
        processed_source = process(options[:stdin], path)

        checksum = processed_source.checksum
        if checksums.include?(checksum)
          raise CorrectionLoop, "two Layout cops are undoing each other's corrections, so the " \\
                                "source would never settle - it was left unchanged by the RuboCop pass"
        end
        checksums << checksum

        iterations += 1
        if iterations > MAX_ITERATIONS
          raise CorrectionLoop, "the RuboCop pass was still making corrections after " \\
                                "#{MAX_ITERATIONS} rounds, so it was stopped"
        end

        team = RuboCop::Cop::Team.mobilize(@registry, @config, options)
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
    def process(source, path)
      processed_source = RuboCop::ProcessedSource.new(
        source, @config.target_ruby_version, path, parser_engine: @config.parser_engine
      )
      processed_source.config = @config
      processed_source.registry = @registry
      processed_source
    end
  end
end
`
