// What gets benchmarked, and what each package is benchmarked *against*.
//
// One entry per comparison: the package as a consumer installs it, and the
// native tool it is a compile of. The native side is resolved the same way the
// conformance tests resolve it - by asking the tool for its version and holding
// it to the version the artifact was built from - because a benchmark against
// some other release of the same tool measures two different programs.
//
// Where a version cannot be matched the entry is not silently dropped: it
// reports why, and what to install, so a missing row is a fact about this
// machine rather than a gap in the harness.

import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import { readPhar } from '../../packages/php/src/read-phar'
import { buildRuboCopConfig } from '../../packages/ruby/src/rubocop'

const root = path.join(import.meta.dir, '..', '..')

/** The two input sizes every target is measured at. */
export type SampleSize = 'small' | 'real'

/** A native tool that is present, at the version this repo compiled. */
export type ResolvedNative = {
  /** Version banner, quoted in the report so the comparison is attributable. */
  version: string
  /** Anything the tool needs in the workspace before timing starts - a phar, a config file. */
  prepare?: (workspace: string) => void
  /** Formats every file in place, in one process. `files` are absolute paths under `<workspace>/src`. */
  run: (workspace: string, files: readonly string[]) => void
}

/** Why a native tool could not be measured here, and how to get it. */
export type MissingNative = { unavailable: string }

export type NativeResolution = ResolvedNative | MissingNative

export const isMissing = (resolution: NativeResolution): resolution is MissingNative => 'unavailable' in resolution

export type Target = {
  /** Short id, used on the command line and as the row label. */
  id: string
  /** The published package under test. */
  packageName: string
  /** The directory under `packages/` whose `dist` is loaded. */
  packageDir: string
  /** The tool this package is a compile of, named as the report should name it. */
  tool: string
  /** Extension the native tool expects on disk. */
  extension: string
  /** Sample basenames under `scripts/benchmark/samples/<size>/`. */
  sample: Record<SampleSize, string>
  /** Options handed to `format`, when the comparison needs something other than the defaults. */
  formatOptions?: Record<string, unknown>
  /**
   * Options handed to `init`, where the package takes any.
   *
   * Ruby is the one that needs this: `init()` loads RuboCop by default, which
   * costs about four seconds, so timing `{ rubocop: false }` formatting against
   * an `init` that loaded RuboCop anyway would price a pass that never runs.
   */
  initOptions?: Record<string, unknown>
  /**
   * Whether `format` takes an array as well as a string.
   *
   * Only the PHP package does, and it matters: the group path runs the fixer's
   * setup once for the whole group and spreads the work over several instances,
   * so it is a different program from a loop over single calls - and worth
   * measuring separately rather than being represented by the slow one.
   */
  groupFormat?: true
  /** Extra note printed under the table, where the comparison needs one. */
  note?: string
  resolveNative: () => NativeResolution
}

/** Reads a gem's pin from the Gemfile the Ruby artifact is built from. */
const gemPin = (gem: string): string => {
  const gemfile = path.join(root, 'build', 'ruby_fmt', 'Gemfile')
  const match = fs.readFileSync(gemfile, 'utf8').match(new RegExp(`^gem "${gem}", "([^"]+)"$`, 'm'))
  if (!match?.[1]) throw new Error(`could not read the ${gem} pin from ${gemfile}`)
  return match[1]
}

/** Reads a gem's resolved version from the lockfile, for gems the Gemfile does not name. */
const lockedGem = (gem: string): string => {
  const lockfile = path.join(root, 'build', 'ruby_fmt', 'Gemfile.lock')
  const match = fs.readFileSync(lockfile, 'utf8').match(new RegExp(`^ {4}${gem} \\(([^)]+)\\)$`, 'm'))
  if (!match?.[1]) throw new Error(`could not read the ${gem} version from ${lockfile}`)
  return match[1]
}

/** Whether a native ruby can activate this gem at exactly this version. */
const gemActivates = (gem: string, version: string): boolean => {
  const result = spawnSync('ruby', ['-e', `gem "${gem}", "${version}"`], { encoding: 'utf8' })
  return result.status === 0
}

/**
 * Runs a ruby script over the workspace, with the pinned gems activated.
 *
 * `-EUTF-8` because the default external encoding is US-ASCII when no locale is
 * set, which makes any non-ASCII sample blow up on the native side only.
 */
const runRuby = (workspace: string, script: string, files: readonly string[]): void => {
  execFileSync('ruby', ['-EUTF-8', '-e', script, '--', ...files], {
    cwd: workspace,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

/** The syntax_tree pass on its own, which is what `{ rubocop: false }` compares against. */
const syntaxTreeScript = (): string => `
  gem "syntax_tree", "${gemPin('syntax_tree')}"
  require "syntax_tree"
  ARGV.each { |file| File.write(file, SyntaxTree.format(File.read(file))) }
`

/**
 * syntax_tree followed by `rubocop --autocorrect --only Layout`, in one process.
 *
 * One process because that is what the package does: `@scalar/ruby-fmt` runs
 * both passes inside a single VM, so a native side that paid two ruby boots
 * would be measuring the shell, not the formatter.
 *
 * RuboCop is driven through `RuboCop::CLI` - the same class its binstub calls -
 * under explicit `gem` activations, so the versions are the pinned ones rather
 * than whatever is newest on the machine. Caching is off because a cache hit
 * would hand back a previous run's answer instead of doing the work, which is
 * exactly the work being timed.
 */
const rubyBothPassesScript = (): string => `
  gem "syntax_tree", "${gemPin('syntax_tree')}"
  gem "rubocop", "${gemPin('rubocop')}"
  gem "rubocop-ast", "${gemPin('rubocop-ast')}"
  gem "parser", "${lockedGem('parser')}"
  require "syntax_tree"
  ARGV.each { |file| File.write(file, SyntaxTree.format(File.read(file))) }
  require "rubocop"
  $stdout.reopen(File::NULL, "w")
  RuboCop::CLI.new.run(["--autocorrect", "--only", "Layout", "--cache", "false", "--no-color", *ARGV])
`

/** google-java-format needs these to reach the compiler internals it formats with. */
const JAVAC_EXPORTS = ['api', 'code', 'file', 'main', 'parser', 'tree', 'util'].map(
  (pkg) => `--add-exports=jdk.compiler/com.sun.tools.javac.${pkg}=ALL-UNNAMED`,
)

/** Reads a version banner from either stream, because these tools disagree about which one to use. */
const bannerOf = (file: string, args: readonly string[]): string => {
  const result = spawnSync(file, [...args, '--version'], { encoding: 'utf8' })
  return `${result.stdout ?? ''}${result.stderr ?? ''}`
}

/**
 * Reads a version constant out of a file in this repo.
 *
 * Read rather than restated, because a version written down twice is a version
 * that will eventually disagree with itself - and the whole point of pinning
 * here is that the tool on the other side of the comparison is the same program
 * the artifact was built from.
 */
const constantFrom = (file: string, pattern: RegExp): string => {
  const match = fs.readFileSync(path.join(root, file), 'utf8').match(pattern)
  if (!match?.[1]) throw new Error(`could not read a version from ${file}`)
  return match[1]
}

const gjfVersion = constantFrom('packages/java/src/version.ts', /googleJavaFormatVersion = '([^']+)'/)
const ktfmtVersion = constantFrom('packages/kotlin/src/version.ts', /ktfmtVersion = '([^']+)'/)

/** The rustfmt commit build.sh pins, which is the only rustfmt this artifact matches. */
const rustPin = (): string => {
  const script = fs.readFileSync(path.join(root, 'build', 'rust_fmt', 'build.sh'), 'utf8')
  const match = script.match(/RUST_COMMIT:-([0-9a-f]{40})/)
  if (!match?.[1]) throw new Error('could not read RUST_COMMIT from build/rust_fmt/build.sh')
  return match[1]
}

const csharpierVersion = constantFrom(
  'build/csharp_fmt/build.sh',
  /CSHARPIER_VERSION="\$\{CSHARPIER_VERSION:-([^}"]+)\}"/,
)

export const TARGETS: readonly Target[] = [
  {
    id: 'ruby',
    packageName: '@scalar/ruby-fmt',
    packageDir: 'ruby',
    tool: 'syntax_tree + RuboCop',
    extension: 'rb',
    sample: { small: 'client.rb', real: 'client.rb' },
    note: 'The default pipeline: syntax_tree, then `rubocop --autocorrect --only Layout`. Both sides run both passes in one process.',
    resolveNative: () => {
      const pins: [string, string][] = [
        ['syntax_tree', gemPin('syntax_tree')],
        ['rubocop', gemPin('rubocop')],
        ['rubocop-ast', gemPin('rubocop-ast')],
        ['parser', lockedGem('parser')],
      ]
      const missing = pins.filter(([gem, version]) => !gemActivates(gem, version))
      if (missing.length > 0) {
        const list = missing.map(([gem, version]) => `${gem} ${version}`).join(', ')
        return { unavailable: `not installed: ${list} (gem install <name> -v <version>)` }
      }

      const script = rubyBothPassesScript()
      return {
        version: pins.map(([gem, version]) => `${gem} ${version}`).join(', '),
        prepare: (workspace) => fs.writeFileSync(path.join(workspace, '.rubocop.yml'), buildRuboCopConfig()),
        run: (workspace, files) => runRuby(workspace, script, files),
      }
    },
  },
  {
    id: 'ruby-syntax-tree',
    packageName: '@scalar/ruby-fmt',
    packageDir: 'ruby',
    tool: 'syntax_tree',
    extension: 'rb',
    sample: { small: 'client.rb', real: 'client.rb' },
    formatOptions: { rubocop: false },
    initOptions: { rubocop: false },
    note: 'The same package with `{ rubocop: false }`, which is what isolates syntax_tree from the Layout pass.',
    resolveNative: () => {
      const version = gemPin('syntax_tree')
      if (!gemActivates('syntax_tree', version)) {
        return { unavailable: `syntax_tree ${version} is not installed (gem install syntax_tree -v ${version})` }
      }

      const script = syntaxTreeScript()
      return {
        version: `syntax_tree ${version}`,
        run: (workspace, files) => runRuby(workspace, script, files),
      }
    },
  },
  {
    id: 'java',
    packageName: '@scalar/java-fmt',
    packageDir: 'java',
    tool: 'google-java-format',
    extension: 'java',
    sample: { small: 'Client.java', real: 'Client.java' },
    resolveNative: () => {
      if (bannerOf('google-java-format', []).includes(gjfVersion)) {
        return {
          version: `google-java-format ${gjfVersion}`,
          run: (_workspace, files) => {
            execFileSync('google-java-format', ['--replace', ...files], { encoding: 'utf8', stdio: 'pipe' })
          },
        }
      }

      for (const pipeline of ['java_fmt_teavm', 'java_fmt']) {
        const jar = path.join(root, 'build', pipeline, 'toolchain', `google-java-format-${gjfVersion}-all-deps.jar`)
        if (!fs.existsSync(jar)) continue
        const args = [...JAVAC_EXPORTS, '-jar', jar]
        if (!bannerOf('java', args).includes(gjfVersion)) continue
        return {
          version: `google-java-format ${gjfVersion} (${path.relative(root, jar)})`,
          run: (_workspace, files) => {
            execFileSync('java', [...args, '--replace', ...files], { encoding: 'utf8', stdio: 'pipe' })
          },
        }
      }

      return {
        unavailable: `no google-java-format ${gjfVersion} (run bun run java:build, or put the -all-deps jar in build/java_fmt_teavm/toolchain)`,
      }
    },
  },
  {
    id: 'kotlin',
    packageName: '@scalar/kotlin-fmt',
    packageDir: 'kotlin',
    tool: 'ktfmt',
    extension: 'kt',
    sample: { small: 'Client.kt', real: 'Client.kt' },
    resolveNative: () => {
      if (bannerOf('ktfmt', []).includes(ktfmtVersion)) {
        return {
          version: `ktfmt ${ktfmtVersion}`,
          run: (_workspace, files) => {
            execFileSync('ktfmt', [...files], { encoding: 'utf8', stdio: 'pipe' })
          },
        }
      }

      // ktfmt ships without its dependencies, so the jar alone will not run: the
      // Kotlin compiler, its runtime and google-java-format's layout engine all
      // have to be on the classpath beside it. `bun run kotlin:build` puts them
      // there; KTFMT_JAR is the escape hatch for a jar that bundles its own.
      const bundled = process.env['KTFMT_JAR']
      const work = path.join(root, 'build', 'java_fmt_teavm', 'kotlin-probe', 'work')
      const jars = [
        'ktfmt.jar',
        'kotlin-compiler-embeddable.jar',
        'kotlin-stdlib.jar',
        'kotlin-reflect.jar',
        'kotlin-script-runtime.jar',
        'kotlin-daemon-embeddable.jar',
        'coroutines.jar',
        'annotations.jar',
        'gjf.jar',
        'guava.jar',
      ].map((jar) => path.join(work, jar))

      const classpath = bundled ?? (jars.every((jar) => fs.existsSync(jar)) ? jars.join(path.delimiter) : undefined)
      if (classpath === undefined) {
        return {
          unavailable: `no ktfmt ${ktfmtVersion} (run bun run kotlin:build, or set KTFMT_JAR to a jar-with-dependencies)`,
        }
      }

      const args = ['-cp', classpath, 'com.facebook.ktfmt.cli.Main']
      if (!bannerOf('java', args).includes(ktfmtVersion)) {
        return { unavailable: `the ktfmt on the classpath is not ${ktfmtVersion}` }
      }

      return {
        version: `ktfmt ${ktfmtVersion}`,
        run: (_workspace, files) => {
          execFileSync('java', [...args, ...files], { encoding: 'utf8', stdio: 'pipe' })
        },
      }
    },
  },
  {
    id: 'csharp',
    packageName: '@scalar/csharp-fmt',
    packageDir: 'csharp',
    tool: 'CSharpier',
    extension: 'cs',
    sample: { small: 'Client.cs', real: 'Client.cs' },
    resolveNative: () => {
      const result = spawnSync('csharpier', ['--version'], { encoding: 'utf8' })
      if (result.status !== 0 || !(result.stdout ?? '').includes(csharpierVersion)) {
        const install = `dotnet tool install -g csharpier --version ${csharpierVersion}`
        return { unavailable: `no csharpier ${csharpierVersion} (${install})` }
      }

      return {
        version: `csharpier ${csharpierVersion}`,
        // A directory rather than the file list: CSharpier's own CLI takes a
        // path and walks it, and walking one flat directory of samples is the
        // shape a user's `csharpier format .` actually has.
        run: (workspace) => {
          execFileSync('csharpier', ['format', path.join(workspace, 'src')], { encoding: 'utf8', stdio: 'pipe' })
        },
      }
    },
  },
  {
    id: 'php',
    packageName: '@scalar/php-fmt',
    packageDir: 'php',
    tool: 'PHP CS Fixer',
    extension: 'php',
    sample: { small: 'client.php', real: 'client.php' },
    groupFormat: true,
    note: 'The native side runs the very phar the package ships, on a native PHP - so this is one tool on two runtimes.',
    resolveNative: () => {
      const probe = spawnSync('php', ['-r', 'exit(extension_loaded("Phar") ? 0 : 1);'], { encoding: 'utf8' })
      if (probe.status !== 0) return { unavailable: 'no php with the Phar extension on PATH' }

      const banner = spawnSync('php', ['-r', 'echo PHP_VERSION;'], { encoding: 'utf8' }).stdout ?? 'unknown'

      return {
        version: `the shipped phar on php ${banner.trim()}`,
        prepare: (workspace) => {
          const sourceDir = path.join(workspace, 'src')
          fs.writeFileSync(path.join(workspace, 'php-cs-fixer.phar'), readPhar())
          fs.writeFileSync(
            path.join(workspace, '.php-cs-fixer.php'),
            `<?php
return (new PhpCsFixer\\Config('php-fmt'))
    ->setRules(['@PSR12' => true])
    ->setIndent('    ')
    ->setLineEnding("\\n")
    ->setRiskyAllowed(false)
    ->setUsingCache(false)
    ->setFinder(PhpCsFixer\\Finder::create()->in(${JSON.stringify(sourceDir)})->name('*.php'));
`,
          )
        },
        run: (workspace) => {
          execFileSync(
            'php',
            [
              path.join(workspace, 'php-cs-fixer.phar'),
              'fix',
              `--config=${path.join(workspace, '.php-cs-fixer.php')}`,
              '--no-interaction',
              '-q',
            ],
            { cwd: workspace, encoding: 'utf8', stdio: 'pipe' },
          )
        },
      }
    },
  },
  {
    id: 'rust',
    packageName: '@scalar/rust-fmt',
    packageDir: 'rust',
    tool: 'rustfmt',
    extension: 'rs',
    sample: { small: 'client.rs', real: 'client.rs' },
    resolveNative: () => {
      const rustfmt = process.env['RUSTFMT'] ?? 'rustfmt'
      const result = spawnSync(rustfmt, ['--version'], { encoding: 'utf8' })
      if (result.status !== 0) return { unavailable: 'rustfmt is not installed (rustup component add rustfmt)' }

      const banner = (result.stdout ?? '').trim()
      const commit = banner.match(/\(([0-9a-f]{9,40})\s/)?.[1]
      const pinned = commit !== undefined && rustPin().startsWith(commit)

      return {
        // Reported rather than refused: rustfmt's speed does not move between
        // point releases the way its *output* does, so an unpinned rustfmt is
        // still a fair clock even though it would not be a fair diff. The
        // banner is printed so the reader can see which one it was.
        version: pinned ? banner : `${banner} (not the pinned build - timing only)`,
        run: (workspace, files) => {
          execFileSync(rustfmt, [...files], { cwd: workspace, encoding: 'utf8', stdio: 'pipe' })
        },
      }
    },
  },
  {
    id: 'swift',
    packageName: '@scalar/swift-fmt',
    packageDir: 'swift',
    tool: 'swift-format',
    extension: 'swift',
    sample: { small: 'Client.swift', real: 'Client.swift' },
    resolveNative: () => {
      const result = spawnSync('swift-format', ['--version'], { encoding: 'utf8' })
      if (result.status !== 0) return { unavailable: 'swift-format is not on PATH (it ships with a Swift 6 toolchain)' }

      return {
        version: `swift-format ${(result.stdout ?? '').trim()}`,
        // `--configuration {}` for the same reason the conformance test passes
        // it: it stops a `.swift-format` anywhere above the workspace from
        // turning this into a comparison against someone else's settings.
        run: (_workspace, files) => {
          execFileSync('swift-format', ['format', '--in-place', '--configuration', '{}', ...files], {
            encoding: 'utf8',
            stdio: 'pipe',
          })
        },
      }
    },
  },
]
