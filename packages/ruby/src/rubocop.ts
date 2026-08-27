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
 * Loads RuboCop into the artifact and defines the Layout pass over it.
 *
 * Evaluated at *build* time, not at runtime. `build/ruby_fmt/preinit.ts` runs
 * this inside the VM that wizer then snapshots, so the artifact ships with
 * RuboCop required and `ScalarRubyFmt` defined. It used to run on the first
 * call that asked for RuboCop and cost about nine seconds every time a VM was
 * booted or recycled, which is the whole reason the artifact is pre-initialized
 * at all.
 *
 * It stays here rather than moving under `build/` because it is the definition
 * of the pass this package performs - `format.ts` calls `ScalarRubyFmt.correct`,
 * `boot-vm.ts` calls `ScalarRubyFmt.setup`, and
 * `test/rubocop-conformance.test.ts` is the check on what it claims below.
 * Editing it means rebuilding the artifact; nothing at runtime reads it.
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

  # What \`warm\` corrects at build time. Small, and deliberately not
  # already clean: \`Layout/EmptyLinesAroundAttributeAccessor\` corrects it, so
  # the warm run goes round the correction loop twice rather than exiting on the
  # first pass and leaving half the path cold.
  WARM_SAMPLE = "class Client\\n  attr_reader :base_url\\n  def to_s\\n    @base_url\\n  end\\nend\\n"

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

    # Does the part of RuboCop's start-up that is the same in every VM, so that
    # no VM has to do it again.
    #
    # Called at *build* time only, from \`build/ruby_fmt/preinit.ts\`, inside the
    # VM wizer snapshots. Nothing at runtime calls it.
    #
    # \`ConfigLoader.default_configuration\` parses and validates RuboCop's own
    # ~600-cop default.yml, and every \`configuration_from_file\` merges onto the
    # result. It costs about a second, it is memoized on \`ConfigLoader\` rather
    # than on us, and - the point - it depends on nothing a caller can vary: two
    # VMs given completely different \`.rubocop.yml\` files compute the identical
    # object here. So it belongs in the artifact, and a snapshot taken after this
    # call carries it into every VM restored from it.
    #
    # Left unwarmed it was paid on the first RuboCop format of a VM, which made
    # a cold start ~680ms slower and made every recycle expensive again - the
    # recycles this package performs to survive the linear-memory leak
    # (see format.ts). Warmed, that first \`config_for\` is ~11ms.
    #
    # The throwaway correction warms the rest of the path: instantiating the
    # Layout department and the constant lookups each cop performs on first use
    # are another ~120ms, and are per-VM for the same reason.
    #
    # The config is written by the caller rather than built here so that the one
    # this warms on is \`buildRuboCopConfig\`'s own output - warming against a
    # config the package would never produce would warm the wrong parser, since
    # \`TargetRubyVersion\` is what decides whether RuboCop parses with prism or
    # with the \`parser\` gem.
    #
    # Only that one config is warmed, and deliberately. The parser half of the
    # warm is per target version - \`Parser::Ruby32\` and \`Parser::Ruby31\` are
    # different classes, and loading one does nothing for the other - so warming
    # every version this package supports would mean baking in fourteen of them.
    # A caller on a target below 3.3 therefore still loads its own parser on its
    # first format (~150ms, once per VM); what it does not pay is the second for
    # default.yml, which is the part worth carrying. The way out of that 150ms is
    # \`TargetRubyVersion: 3.3\` or above, which is on prism and is the faster
    # parser anyway.
    #
    # It costs the artifact ~6.6MB of Ruby heap, which is also ~6.6MB off the
    # headroom a fresh VM has before \`MEMORY_LIMIT_BYTES\` recycles it (see
    # format.ts). That trade is worth taking as it stands - a recycled VM is
    # restored from this same snapshot, so it comes back warm, and the recycle
    # that used to cost a config reparse on top of the instantiation no longer
    # does - but the ceiling was picked against a VM that started ~6.6MB lower,
    # and is worth re-measuring against a rebuilt artifact.
    #
    # \`@configs\` is emptied on the way out, and \`setup\` empties it again in
    # every VM: the warm config's path exists on the build machine and not in
    # the guest a consumer runs, and a cache entry naming it would be a hit for
    # a file that is not there.
    def warm(work_dir, config_path)
      setup(work_dir)
      RuboCop::ConfigLoader.default_configuration
      correct(WARM_SAMPLE, File.join(work_dir, "warm.rb"), config_path)
      @configs = {}
      nil
    end

    # The parsed config for one config file, built at most once per path.
    #
    # Cached because merging a config over RuboCop's default.yml is ~11ms in a
    # warmed VM and about a second in one that is not (see \`warm\`), and a
    # caller formatting many files with the same options should pay it once
    # either way. Keyed by path, and the JavaScript side keeps one path per
    # distinct config, so a hit can never be a stale answer for different
    # settings.
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
