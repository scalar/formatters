import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

/** File extensions each package's corpus is made of. */
const extensions: Record<string, string[]> = {
  csharp: ['.cs'],
  java: ['.java'],
  kotlin: ['.kt'],
  php: ['.php'],
  ruby: ['.rb'],
  rust: ['.rs'],
  swift: ['.swift'],
}

/** One corpus file: the bytes to format and the name to blame when it fails. */
export type CorpusFile = { name: string; source: string }

/**
 * Collects a package's benchmark corpus from `bench/corpus/<package>`.
 *
 * The directory is gitignored and filled by `scripts/bench/fetch-corpus.sh`,
 * which pulls real sources from the same upstream projects the conformance tests
 * use. Real files matter more here than in a correctness test: formatter cost is
 * superlinear in nesting depth and expression width, so a corpus of hand-written
 * snippets reports a throughput no consumer will ever see.
 *
 * Returns an empty array when the corpus is absent, so a fresh clone reports
 * "no corpus, skipped" rather than failing.
 */
export const corpusFor = (name: string): CorpusFile[] => {
  const suffixes = extensions[name]
  if (!suffixes) return []

  const dir = path.join(import.meta.dir, '..', '..', 'bench', 'corpus', name)
  if (!existsSync(dir)) return []

  const files: CorpusFile[] = []

  const walk = (current: string): void => {
    for (const entry of readdirSync(current).sort()) {
      const full = path.join(current, entry)
      if (statSync(full).isDirectory()) {
        walk(full)
        continue
      }
      if (!suffixes.some((suffix) => entry.endsWith(suffix))) continue
      files.push({ name: path.relative(dir, full), source: readFileSync(full, 'utf8') })
    }
  }

  walk(dir)

  return files
}
