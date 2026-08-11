import { ConsoleStdout, File, OpenFile, PreopenDirectory, WASI } from '@bjorn3/browser_wasi_shim'

import { compileArtifact } from './compile-artifact'
import type { SwiftFormatModule } from './types'

let modulePromise: Promise<SwiftFormatModule> | undefined

/**
 * Boots swift-format (wasm) and returns the handles a format needs.
 *
 * The module is a WASI reactor: it is instantiated once and its `run` export is
 * called per format, rather than being re-instantiated each time. That measured
 * 2.5x faster over a 442-file corpus, and unlike the Ruby package's VM its
 * linear memory plateaus - 54MB after boot, 75MB after the first hundred files,
 * flat from there through 7.2MB of cumulative input.
 *
 * `@bjorn3/browser_wasi_shim` rather than `node:wasi` for the same reason the
 * Ruby package uses it: it is pure JavaScript with an in-memory filesystem, so
 * the source being formatted never touches disk.
 */
export const bootModule = (): Promise<SwiftFormatModule> => {
  if (modulePromise) return modulePromise

  modulePromise = (async () => {
    const workFiles = new Map<string, File>()
    const diagnostics: string[] = []

    // fds 0/1/2 are stdin/stdout/stderr; preopened dirs start at fd 3. Passing
    // a directory in one of the first three slots silently makes it stdio.
    const wasi = new WASI(
      ['swift_fmt'],
      [],
      [
        new OpenFile(new File([])),
        ConsoleStdout.lineBuffered(() => {}),
        ConsoleStdout.lineBuffered((line) => diagnostics.push(line)),
        new PreopenDirectory('/work', workFiles),
      ],
      // Required: the shim's debug.enable(undefined) resolves to `true`, so
      // omitting this floods stdout with "wasi:" tracing on every syscall.
      { debug: false },
    )

    const instance = await WebAssembly.instantiate(await compileArtifact(), {
      wasi_snapshot_preview1: wasi.wasiImport,
    })

    // A reactor exports `_initialize` instead of `_start`; this runs the Swift
    // runtime's global initialisers without running a main.
    //
    // The shim types `initialize` against a narrower instance than
    // `WebAssembly.Instance` - it wants `exports.memory` declared, which the
    // standard type does not carry - so the instance is widened here rather
    // than the shim's expectations being weakened.
    wasi.initialize(instance as unknown as Parameters<typeof wasi.initialize>[0])

    const run = instance.exports['run'] as () => number
    return { run, workFiles, diagnostics } satisfies SwiftFormatModule
  })()

  return modulePromise
}

/**
 * Drops the cached instance so the next format boots a fresh one.
 *
 * A shared instance is shared failure state: a trap leaves the Swift runtime
 * mid-call with no way to unwind, and every later `run` on that instance would
 * inherit the mess. Dropping it costs an instantiate (~150ms), not a
 * decompress and compile - `compileArtifact` still has the module cached.
 */
export const recycleModule = (): void => {
  modulePromise = undefined
}
