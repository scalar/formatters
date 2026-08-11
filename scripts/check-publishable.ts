// Runs from each package's `prepack`, so a broken tarball fails at pack time
// rather than after it is on the registry.
//
// Nothing here is package-specific: it reads the manifest and checks that every
// path the manifest promises actually exists. That catches the two ways this
// repo can produce an empty-looking package - packing before `bun run build`
// has written `dist`, and packing from a partial checkout that is missing the
// committed wasm artifact.
//
// It depends on no build of its own: `prepack` runs it as `node
// scripts/check-publishable.ts` and Node strips the types itself, unflagged
// since 22.18 and 23.6. That does put a floor under whoever publishes - which
// is CI on Node 24 - but not under anyone installing a package, since `prepack`
// never runs on install.

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

/** The fields of a package manifest this script reads. Everything else is ignored. */
type Manifest = {
  name: string
  files?: string[]
  main?: string
  types?: string
  exports?: ExportsEntry
}

/** An `exports` map is a string, or a conditions object nesting more of the same. */
type ExportsEntry = string | { [condition: string]: ExportsEntry }

const packageDir = process.cwd()
const manifest: Manifest = JSON.parse(await readFile(path.join(packageDir, 'package.json'), 'utf8'))

/** Every relative path an export condition points at, flattened out of the exports map. */
const exportTargets = (node: ExportsEntry | undefined): string[] => {
  if (typeof node === 'string') return [node]
  if (node && typeof node === 'object') return Object.values(node).flatMap(exportTargets)
  return []
}

const promised = [
  ...(manifest.files ?? []),
  ...[manifest.main, manifest.types].filter((entry): entry is string => Boolean(entry)),
  ...exportTargets(manifest.exports),
]

const missing = [...new Set(promised)].filter((entry) => !existsSync(path.join(packageDir, entry)))

if (missing.length > 0) {
  console.error(
    `${manifest.name} is not publishable - the manifest points at files that do not exist:\n` +
      `${missing.map((entry) => `  - ${entry}`).join('\n')}\n` +
      'Run `bun run build` (and `bun run ruby:build` if the wasm artifact is missing) first.',
  )
  process.exit(1)
}
