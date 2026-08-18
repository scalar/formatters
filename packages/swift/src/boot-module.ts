import { ConsoleStdout, File, OpenFile, PreopenDirectory, WASI } from '@bjorn3/browser_wasi_shim'

import type { ArtifactSource, BootModule, SwiftFormatModule } from './types'

/** A WASI environment ready to be handed an instance. */
type Pending = {
  wasi: WASI
  workFiles: Map<string, File>
  diagnostics: string[]
}

/** The import object an instance is built against, from the shim's own WASI. */
const importsFor = (wasi: WASI) => ({ wasi_snapshot_preview1: wasi.wasiImport })

/**
 * Builds the WASI environment one instance runs in.
 *
 * `@bjorn3/browser_wasi_shim` rather than `node:wasi`: it is pure JavaScript
 * with an in-memory filesystem, so the source being formatted never touches
 * disk, and carrying no Node built-ins of its own it is what makes the browser
 * build possible at all.
 */
const prepare = (): Pending => {
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

  return { wasi, workFiles, diagnostics }
}

/** Runs the module's initialisers and returns the handles a format needs. */
const finish = ({ wasi, workFiles, diagnostics }: Pending, instance: WebAssembly.Instance): SwiftFormatModule => {
  // A reactor exports `_initialize` instead of `_start`; this runs the module's
  // initialisers without running a main.
  //
  // The shim types `initialize` against a narrower instance than
  // `WebAssembly.Instance` - it wants `exports.memory` declared, which the
  // standard type does not carry - so the instance is widened here rather than
  // the shim's expectations being weakened.
  wasi.initialize(instance as unknown as Parameters<typeof wasi.initialize>[0])

  const run = instance.exports['run'] as () => number
  return { run, workFiles, diagnostics } satisfies SwiftFormatModule
}

/**
 * Instantiates the compiled module, asynchronously.
 *
 * This is the path a boot takes, and it is async for a reason that only shows
 * up in a browser: `WebAssembly.Instance` is refused on the main thread once the
 * module is over 8MB, exactly like the synchronous compile is. `instantiate` is
 * not, at any size.
 *
 * The module is a WASI reactor: it is instantiated once and its `run` export is
 * called per format, rather than being re-instantiated each time.
 */
const instantiate = async (module: WebAssembly.Module): Promise<SwiftFormatModule> => {
  const pending = prepare()
  return finish(pending, await WebAssembly.instantiate(module, importsFor(pending.wasi)))
}

/**
 * Instantiates the compiled module without awaiting, or `undefined` if this
 * environment will not do that.
 *
 * Recovering from a trap inside `formatSync` has to happen synchronously or not
 * at all, and on an already-compiled module there is nothing to compile - so
 * where the engine allows it this costs a few milliseconds and the synchronous
 * caller never notices. A browser main thread refuses above 8MB, which is the
 * one case that cannot be served; there the instance is dropped instead and the
 * caller is told to `await init()`. Off the main thread, and under Node, the
 * limit does not apply at all.
 */
const instantiateSync = (module: WebAssembly.Module): SwiftFormatModule | undefined => {
  const pending = prepare()
  try {
    return finish(pending, new WebAssembly.Instance(module, importsFor(pending.wasi)))
  } catch {
    return undefined
  }
}

/**
 * Builds the lifecycle for one artifact source.
 *
 * The source is a parameter rather than an import because this package has two
 * of them - `compile-artifact.ts` reads the file from disk under Node,
 * `fetch-artifact.ts` fetches it over HTTP in a browser - and the browser build
 * must not so much as mention `node:fs`. Passing the source in is what keeps
 * the two entry points sharing this file instead of duplicating it.
 *
 * Each call closes over its own cache, so the module is booted at most once per
 * source per process.
 */
export const createBootModule = (compileArtifact: ArtifactSource): BootModule => {
  let bootPromise: Promise<SwiftFormatModule> | undefined

  /**
   * The compiled module, kept because recycling needs it *synchronously*.
   *
   * Compilation is cached separately from instantiation because they have very
   * different lifetimes: the compiled module is immutable and worth keeping
   * forever, while an instance is dropped and replaced whenever a format traps.
   */
  let compiled: WebAssembly.Module | undefined

  /** The live instance, readable without awaiting - see `peek`. */
  let current: SwiftFormatModule | undefined

  const boot = (): Promise<SwiftFormatModule> => {
    // The rejection is not cached, so a boot that failed on a transient problem
    // can be retried by calling again rather than sticking for the process.
    bootPromise ??= compileArtifact()
      .then(async (module) => {
        compiled = module
        current = await instantiate(module)
        return current
      })
      .catch((error: unknown) => {
        bootPromise = undefined
        throw error
      })

    return bootPromise
  }

  /**
   * The booted instance, or `undefined` if the boot has not finished.
   *
   * This is what `formatSync` is built on: it turns "has the async work already
   * happened" into a question a synchronous caller can ask, instead of one only
   * an `await` can answer.
   */
  const peek = (): SwiftFormatModule | undefined => current

  /**
   * Replaces the instance with a fresh one, synchronously where it can.
   *
   * A shared instance is shared failure state: a trap leaves the module mid-call
   * with no way to unwind, and every later `run` on that instance would inherit
   * the mess. Replacing it costs an instantiate, not a decompress and compile,
   * because the compiled module is still here - which also means a trap taken
   * inside `formatSync` can be recovered from without becoming async.
   *
   * Before the first boot there is nothing compiled to instantiate from, so this
   * clears the cache and leaves the next `boot` to do the work.
   */
  const recycle = (): SwiftFormatModule | undefined => {
    if (!compiled) {
      bootPromise = undefined
      current = undefined
      return undefined
    }

    current = instantiateSync(compiled)

    // The cached boot has to be replaced either way, or the async `format` would
    // keep resolving to the instance that just trapped: `boot` hands back
    // `bootPromise`, not `current`, so leaving it alone recovers the synchronous
    // path and strands the asynchronous one.
    //
    // Cleared rather than replaced when there is nothing to replace it with, so
    // the next `boot` builds a working instance instead of handing back the dead
    // one.
    bootPromise = current ? Promise.resolve(current) : undefined

    return current
  }

  return { boot, peek, recycle }
}
