// Asserts the package prints nothing while formatting.
//
// It used to. Opening ktfmt's parser builds an IntelliJ CoreProjectEnvironment,
// which launches two coroutines and so starts kotlinx.coroutines' scheduler,
// whose workers park; parking is the one thing a single-threaded
// wasm runtime cannot do, so each worker died with an UnsupportedOperationException
// that TeaVM's default handler wrote to stderr - once per process, on the timer
// turns after the first format call resolved. Formatting was correct throughout;
// the output was a Java stack trace at the user's terminal in the middle of a
// pass that had succeeded. See silenceThreadsThisRuntimeCannotRun in
// build/java_fmt_teavm/kotlin-probe/src/ktfmt/java/kfmt/KtFmt.java.
//
// It runs in a child process for two reasons. The report fired once per process,
// so a test sharing this one with the rest of the suite would find it already
// spent and pass for the wrong reason. And a child lets this read the real
// stderr rather than a patched console.error, which is what a consumer's
// terminal actually shows.

import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'bun:test'

const here = path.dirname(fileURLToPath(import.meta.url))
const PROBE = path.join(here, 'stderr-probe.ts')

describe('stderr', () => {
  it('stays empty across a format and the turns after it', () => {
    const probe = spawnSync(process.execPath, [PROBE], { encoding: 'utf8' })

    // Read stdout first: it says whether the probe formatted at all, which is
    // what makes an empty stderr mean something.
    expect(probe.stdout.trim()).toBe('formatted')
    expect(probe.stderr).toBe('')
    expect(probe.status).toBe(0)
  })
})
