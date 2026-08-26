// Diffs two corpus snapshots and decides whether a rebuilt artifact changed
// anything.
//
// This is the gate `CONTRIBUTING.md` asks every output-affecting change to
// answer - "say how you know it did not" - for the Ruby package. The
// package *is* syntax_tree and RuboCop compiled to wasm, so output that moves is
// a bug rather than a tradeoff, and the only passing answer is zero files.
//
// A gate that cannot fail is worse than no gate, so most of this file is about
// refusing to report a pass it has not earned: an empty snapshot, a snapshot
// that is not one, or a build that stopped being able to format a file at all.

import path from 'node:path'

/**
 * A corpus run reduced to what a comparison needs: which artifact produced it,
 * what it was asked for, which files came out, and which ones it could not
 * format.
 *
 * Hashes rather than the formatted text, because the question is only ever "did
 * any file move" and holding several MB of Ruby twice to answer it is a waste.
 *
 * `failures` is here because leaving it out made a real regression unreadable.
 * A file the formatter throws on is simply absent from `files`, so a build that
 * broke fifty files looked exactly like a run over a different corpus - the gate
 * blamed the operator for the very regression it exists to catch.
 */
export type Snapshot = {
  artifact: string
  rubocop: boolean
  files: Record<string, string>
  failures: string[]
}

/** How many files a comparison lists before it summarises the rest. */
const LISTED_FILES = 20

/**
 * Whether a value is a plain object whose values are all strings.
 *
 * Exported because the CLI validates a corpus result's `outputs` with it before
 * that map is written out as a snapshot's `files` - the same shape checked at
 * both ends, so a bad one is caught where it is produced rather than on the next
 * invocation.
 */
export const isRecordOfStrings = (value: unknown): value is Record<string, string> =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  Object.values(value).every((entry) => typeof entry === 'string')

/**
 * Reads a snapshot, or explains why the file is not one.
 *
 * Every field is checked rather than trusted. These files are hand-passed on a
 * command line and sometimes hand-edited, and every unchecked shape here failed
 * in a way that either read as a stack trace or - worse - as a pass.
 */
const readSnapshot = async (file: string): Promise<Snapshot> => {
  // Reached for with `stat` rather than `exists`, which answers false for a
  // directory as well as for a missing path - so `--compare snapshots/ …` after
  // a tab-complete would be told the directory does not exist, which is worse
  // than the JSON error it replaced.
  const stats = await Bun.file(file)
    .stat()
    .catch(() => undefined)

  if (!stats) throw new Error(`${file} does not exist`)
  if (stats.isDirectory()) throw new Error(`${file} is a directory, not a snapshot file`)

  const parsed: unknown = await Bun.file(file)
    .json()
    .catch((error: unknown) => {
      throw new Error(`${file} could not be read as JSON: ${error instanceof Error ? error.message : String(error)}`)
    })

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${file} is not a ruby-bench snapshot`)
  }

  // Destructured as `unknown` rather than as a `Partial<Snapshot>`: asserting
  // each field's type on the line before checking it would be the one piece of
  // trust this whole function exists to withhold.
  const { artifact, rubocop, files, failures } = parsed as Partial<Record<keyof Snapshot, unknown>>

  // `failures` is checked as strictly as the rest. Reading a non-array as "then
  // nothing failed" would turn a truncated or hand-mangled snapshot into a clean
  // one, which is the failure this whole function is here to refuse.
  if (
    typeof artifact !== 'string' ||
    typeof rubocop !== 'boolean' ||
    !isRecordOfStrings(files) ||
    !Array.isArray(failures) ||
    !failures.every((entry) => typeof entry === 'string')
  ) {
    throw new Error(`${file} is not a ruby-bench snapshot - it needs "artifact", "rubocop", "files" and "failures"`)
  }

  // A file cannot both have been formatted and have failed. Nothing this writes
  // produces such a snapshot, but a hand-edited one would be counted twice - as
  // compared and as fixed - and a gate that double-counts is a gate whose
  // numbers cannot be read.
  const both = Object.keys(files).filter((name) => failures.includes(name))
  if (both.length > 0) {
    throw new Error(`${file} lists ${both.length} file(s) as both formatted and failed, starting with ${both[0]}`)
  }

  // Nor can it have failed twice. `files` is an object and unique by
  // construction; `failures` is an array and is not, and a repeated name there
  // inflates the counts this gate reports without changing its verdict - which
  // is the kind of number that sends someone looking for a file that is fine.
  if (new Set(failures).size !== failures.length) {
    throw new Error(`${file} lists the same failed file more than once`)
  }

  return { artifact, rubocop, files, failures }
}

/** Prints a capped list of file names to whichever stream the section went to. */
const list = (write: (line: string) => void, names: string[], describe: (name: string) => string): void => {
  for (const name of names.slice(0, LISTED_FILES)) write(`  ${describe(name)}`)
  if (names.length > LISTED_FILES) write(`  ... and ${names.length - LISTED_FILES} more`)
}

/**
 * Compares two snapshots and exits: zero when nothing moved, non-zero on any
 * difference and on anything that makes the comparison meaningless.
 *
 * Never returns, so the caller does not have to decide what to do afterwards.
 */
export const compareSnapshots = async (beforePath: string, afterPath: string): Promise<never> => {
  const before = await readSnapshot(beforePath)
  const after = await readSnapshot(afterPath)

  if (before.rubocop !== after.rubocop) {
    console.error(
      `these snapshots were taken with different options (rubocop ${String(before.rubocop)} vs ` +
        `${String(after.rubocop)}), so any difference between them says nothing about the artifact`,
    )
    process.exit(1)
  }

  console.log('\n=== corpus comparison ===\n')
  console.log(`before  ${path.basename(beforePath).padEnd(24)} artifact ${before.artifact.slice(0, 12)}`)
  console.log(`after   ${path.basename(afterPath).padEnd(24)} artifact ${after.artifact.slice(0, 12)}`)

  // Worth saying out loud: comparing a build against itself passes trivially,
  // and that is an easy mistake to make when the second snapshot was taken
  // before the rebuild rather than after it.
  if (before.artifact === after.artifact) console.log('\nboth snapshots came from the same artifact')

  // Coverage is every file the run *attempted*, formatted or not. Comparing the
  // formatted sets alone would read a build that broke a file as two different
  // corpora.
  const beforeSeen = new Set([...Object.keys(before.files), ...before.failures])
  const afterSeen = new Set([...Object.keys(after.files), ...after.failures])
  const onlyBefore = [...beforeSeen].filter((name) => !afterSeen.has(name))
  const onlyAfter = [...afterSeen].filter((name) => !beforeSeen.has(name))

  if (onlyBefore.length > 0 || onlyAfter.length > 0) {
    console.error(
      `\nthese snapshots cover different files - ${onlyBefore.length} only in ${path.basename(beforePath)}, ` +
        `${onlyAfter.length} only in ${path.basename(afterPath)}. Compare two runs over the same corpus, ` +
        'taken with the same --files limit.',
    )
    process.exit(1)
  }

  // The set that was actually compared: formatted on both sides, so there are
  // two hashes to hold against each other.
  const compared = Object.keys(before.files).filter((name) => name in after.files)
  const broken = Object.keys(before.files)
    .filter((name) => after.failures.includes(name))
    .sort()
  const fixed = before.failures.filter((name) => name in after.files).sort()
  const stuck = before.failures.filter((name) => after.failures.includes(name)).sort()

  // A comparison over nothing is not a pass, and "nothing" is about the compared
  // set rather than about coverage. Two runs that failed every file cover plenty
  // of files and compare none of them, and reporting "0 differ" over that would
  // be the worst failure this gate has: a build that cannot format anything
  // passing the check that exists to catch exactly that.
  if (compared.length === 0) {
    console.error(
      `\nno file was formatted by both runs, so nothing was compared${
        stuck.length > 0 ? ` - ${stuck.length} file(s) failed in both` : ''
      }. Re-run the corpus measurement against a build that formats it.`,
    )
    process.exit(1)
  }

  if (fixed.length > 0) {
    console.log(`\n${fixed.length} file(s) failed before and format now:`)
    list(console.log, fixed, (name) => name)
  }

  // Reported even when everything else passes: these files are outside the
  // comparison, and a pass that quietly rests on a smaller corpus than it looks
  // like is the kind of green nobody should have to discover later.
  if (stuck.length > 0) {
    console.log(`\n${stuck.length} file(s) failed in both runs and were not compared:`)
    list(console.log, stuck, (name) => name)
  }

  const changed = compared.filter((name) => before.files[name] !== after.files[name]).sort()

  if (broken.length === 0 && changed.length === 0) {
    console.log(`\n${compared.length} file(s) compared, 0 differ`)
    process.exit(0)
  }

  if (broken.length > 0) {
    console.error(`\n${broken.length} file(s) formatted before and fail now:`)
    list(console.error, broken, (name) => name)
  }

  if (changed.length > 0) {
    console.error(`\n${changed.length} of ${compared.length} compared files differ:`)
    list(
      console.error,
      changed,
      (name) => `${name}: ${(before.files[name] ?? '').slice(0, 12)} -> ${(after.files[name] ?? '').slice(0, 12)}`,
    )
  }

  process.exit(1)
}
