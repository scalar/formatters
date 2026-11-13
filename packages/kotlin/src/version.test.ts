// The exported versions are second copies of numbers the build script owns, so
// this reads the script and fails when they disagree. Without it the exports
// would go stale on the next bump and quietly tell consumers to verify against
// a version the artifact is not.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { ktfmtVersion, ktrsVersion } from './index'
import { describe, expect, it } from 'bun:test'

const here = path.dirname(fileURLToPath(import.meta.url))
const BUILD_SCRIPT = path.join(here, '..', '..', '..', 'build', 'kotlin_fmt', 'build.sh')

/** The default a `NAME="${NAME:-value}"` line in the build script gives. */
const pinned = (name: string): string | undefined => {
  const script = fs.readFileSync(BUILD_SCRIPT, 'utf8')
  return new RegExp(`^${name}="\\$\\{${name}:-(?<version>[^}"]+)\\}"`, 'm').exec(script)?.groups?.['version']
}

describe('versions', () => {
  it('ktfmtVersion matches KTFMT_VERSION in the build script', () => {
    const version = pinned('KTFMT_VERSION')
    expect(version, `no KTFMT_VERSION pin found in ${BUILD_SCRIPT}`).toBeDefined()
    expect(ktfmtVersion).toBe(version ?? '')
  })

  it('ktrsVersion matches KTRS_VERSION in the build script', () => {
    const version = pinned('KTRS_VERSION')
    expect(version, `no KTRS_VERSION pin found in ${BUILD_SCRIPT}`).toBeDefined()
    expect(ktrsVersion).toBe(version ?? '')
  })
})
