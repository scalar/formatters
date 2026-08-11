import { ConsoleStdout, File, OpenFile, PreopenDirectory, WASI } from '@bjorn3/browser_wasi_shim'

import { compileArtifact } from './compile-artifact'
import type { RustFormatModule } from './types'

let modulePromise: Promise<RustFormatModule> | undefined

/**
 * Boots rustfmt (wasm) and returns the handles a format needs.
 *
 * The module is a WASI reactor: it is instantiated once and its `run` export is
 * called per format, rather than being re-instantiated each time. That matters
 * more here than elsewhere - the whole 345-file rustfmt corpus runs through one
 * instance in ~530ms, where instantiating per file costs more than the
 * formatting does. Linear memory plateaus at ~35MB and stays there across the
 * corpus.
 *
 * `@bjorn3/browser_wasi_shim` rather than `node:wasi` for the same reason the
 * Ruby and Swift packages use it: it is pure JavaScript with an in-memory
 * filesystem, so the source being formatted never touches disk. It also avoids
 * a real defect in `node:wasi` - repeatedly instantiating a module this size
 * segfaults Node outright after about fifteen instances.
 */
export const bootModule = (): Promise<RustFormatModule> => {
  if (modulePromise) return modulePromise

  modulePromise = (async () => {
    const workFiles = new Map<string, File>()
    const diagnostics: string[] = []

    // fds 0/1/2 are stdin/stdout/stderr; preopened dirs start at fd 3. Passing
    // a directory in one of the first three slots silently makes it stdio.
    const wasi = new WASI(
      ['rust_fmt'],
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

    // A reactor exports `_initialize` instead of `_start`; this runs the
    // module's initialisers without running a main.
    //
    // The shim types `initialize` against a narrower instance than
    // `WebAssembly.Instance` - it wants `exports.memory` declared, which the
    // standard type does not carry - so the instance is widened here rather
    // than the shim's expectations being weakened.
    wasi.initialize(instance as unknown as Parameters<typeof wasi.initialize>[0])

    const run = instance.exports['run'] as () => number
    return { run, workFiles, diagnostics } satisfies RustFormatModule
  })()

  return modulePromise
}

/**
 * Drops the cached instance so the next format boots a fresh one.
 *
 * A shared instance is shared failure state: a trap leaves the module mid-call
 * with no way to unwind, and every later `run` on that instance would inherit
 * the mess. Dropping it costs an instantiate, not a decompress and compile -
 * `compileArtifact` still has the module cached.
 */
export const recycleModule = (): void => {
  modulePromise = undefined
}
