// The exported version is a second copy of a number the build script owns, so
// this reads the script and fails when the two disagree. Without it the export
// would go stale on the next google-java-format bump and quietly tell consumers
// to verify against a version the artifact is not.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { googleJavaFormatVersion } from './index'
import { describe, expect, it } from 'bun:test'

const here = path.dirname(fileURLToPath(import.meta.url))
const BUILD_SCRIPT = path.join(here, '..', '..', '..', 'build', 'java_fmt_teavm', 'build.sh')

describe('googleJavaFormatVersion', () => {
  it('matches GJF_VERSION in the build script', () => {
    const script = fs.readFileSync(BUILD_SCRIPT, 'utf8')
    const pinned = /^GJF_VERSION="\$\{GJF_VERSION:-(?<version>[^}"]+)\}"/m.exec(script)?.groups?.['version']

    expect(pinned, `no GJF_VERSION pin found in ${BUILD_SCRIPT}`).toBeDefined()
    expect(googleJavaFormatVersion).toBe(pinned ?? '')
  })
})
