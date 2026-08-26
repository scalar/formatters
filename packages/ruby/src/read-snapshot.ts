import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import zlib from 'node:zlib'

import { artifactFingerprint } from './compile-artifact'
import { type BootSnapshot, decodeSnapshot } from './snapshot'

const here = path.dirname(fileURLToPath(import.meta.url))

/**
 * The boot snapshot, built by `build/ruby_fmt/write-snapshot.ts`.
 *
 * Stored beside the artifact, and brotli-compressed for the same reason: the
 * pages are mostly Ruby's object heap and pack about five to one, which is the
 * difference between a 37MB and a 7.7MB install.
 *
 * One directory up from this file resolves to the package root whether we are
 * running from `dist` (published) or from `src` (tests), so the same path works
 * in both.
 */
const SNAPSHOT = path.join(here, '..', 'ruby_fmt.snapshot.br')

/** The decoded snapshot, kept so recycling the VM does not decompress it again. */
let snapshotPromise: Promise<BootSnapshot | undefined> | undefined

/**
 * Reads the boot snapshot from disk, at most once per process.
 *
 * Resolves to `undefined` rather than throwing when the file is absent or was
 * taken against a different artifact. That is the whole contract: the snapshot is
 * an accelerator, so a checkout that has not built one, or has a stale one left
 * over from a previous artifact, boots the long way and still works.
 */
export const readSnapshot = (): Promise<BootSnapshot | undefined> => {
  snapshotPromise ??= (async (): Promise<BootSnapshot | undefined> => {
    const artifact = artifactFingerprint()
    if (!artifact || !fs.existsSync(SNAPSHOT)) return undefined

    return decodeSnapshot(zlib.brotliDecompressSync(fs.readFileSync(SNAPSHOT)), artifact)
  })().catch(() => undefined)

  return snapshotPromise
}
