import { ConsoleStdout, File, OpenFile, PreopenDirectory, WASI } from '@bjorn3/browser_wasi_shim'

import type { ArtifactSource, RbcopBoot, RbcopCorrector } from './types'

/**
 * The directory the module writes config files into. It has to be preopened:
 * rbcop reads configuration from a file, the way RuboCop does, so that
 * `inherit_from` and relative `Include`/`Exclude` patterns resolve against
 * where it lives. It must match `WORK_DIR` in build/rbcop_fmt/entry/src/lib.rs.
 */
const WORK_DIR = '/work'

/** What `rbcop_correct` returns when the result is corrected source. */
const OK = 0

/** The module's exports, as build/rbcop_fmt/entry/src/lib.rs defines them. */
type RbcopExports = {
  memory: WebAssembly.Memory
  _initialize: () => void
  rbcop_alloc: (length: number) => number
  rbcop_correct: (source: number, sourceLength: number, config: number, configLength: number) => number
  rbcop_result_ptr: () => number
  rbcop_result_len: () => number
}

/** A WASI environment ready to be handed an instance, with the stderr it collects. */
type Pending = {
  wasi: WASI
  stderr: string[]
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/**
 * Builds the WASI environment one instance runs in.
 *
 * `@bjorn3/browser_wasi_shim` rather than `node:wasi`: it is pure JavaScript
 * with an in-memory filesystem, so the configs rbcop writes never touch disk,
 * and carrying no Node built-ins of its own it is what lets the Node and
 * browser builds run this same file.
 */
const prepare = (): Pending => {
  // stderr is kept, because it is where a Rust panic prints its message, and
  // that message is the only useful thing to say when the instance traps.
  const stderr: string[] = []

  // fds 0/1/2 are stdin/stdout/stderr; preopened dirs start at fd 3. Passing
  // a directory in one of the first three slots silently makes it stdio.
  const wasi = new WASI(
    [],
    [],
    [
      new OpenFile(new File([])),
      ConsoleStdout.lineBuffered(() => {}),
      ConsoleStdout.lineBuffered((line) => stderr.push(line)),
      new PreopenDirectory(WORK_DIR, new Map()),
    ],
    // The shim's debug.enable(undefined) resolves to `true`, so omitting this
    // floods stdout with "wasi:" tracing on every syscall.
    { debug: false },
  )

  return { wasi, stderr }
}

/** The import object an instance is built against, from the shim's own WASI. */
const importsFor = (wasi: WASI): { wasi_snapshot_preview1: WASI['wasiImport'] } => ({
  wasi_snapshot_preview1: wasi.wasiImport,
})

/**
 * Builds the boot pair for rbcop, the RuboCop Layout pass.
 *
 * rbcop is RuboCop 1.92.2 reimplemented in Rust and compiled to a WASI reactor
 * (see build/rbcop_fmt). One instance is booted and reused: it keeps every
 * config it has resolved, and resolving one - merging it over RuboCop's own
 * default.yml - is ~30x what a Layout pass on a typical file costs.
 *
 * The instance does not leak: Rust frees what a format allocates, and linear
 * memory plateaus around 11 MB. The one thing that ends an instance is a trap.
 * Rust panics abort on wasm, so a panic inside rbcop leaves the instance
 * unusable; the trap is reported as an error and the next call instantiates a
 * fresh one from the module the source has already compiled.
 */
export const createRbcop = (source: ArtifactSource): RbcopBoot => {
  /** The live instance. Dropped after a trap, so that the next call replaces it. */
  let current: RbcopCorrector | undefined

  /** An asynchronous instantiation in flight, shared by concurrent `boot` calls. */
  let booting: Promise<RbcopCorrector> | undefined

  /** Runs the reactor's initialisers and wraps the instance in a corrector. */
  const finish = ({ wasi, stderr }: Pending, instance: WebAssembly.Instance): RbcopCorrector => {
    // Runs the reactor's `_initialize`, which is the C constructors and Rust's
    // runtime setup, exactly once.
    //
    // The shim types `initialize` against a narrower instance than
    // `WebAssembly.Instance` - it wants `exports.memory` declared, which the
    // standard type does not carry - so the instance is widened here rather
    // than the shim's expectations being weakened.
    wasi.initialize(instance as unknown as Parameters<typeof wasi.initialize>[0])
    const exports = instance.exports as unknown as RbcopExports

    /** Copies a string into a buffer the module owns, returning (pointer, length). */
    const copyIn = (text: string): [number, number] => {
      const bytes = encoder.encode(text)
      const pointer = exports.rbcop_alloc(bytes.length)
      new Uint8Array(exports.memory.buffer, pointer, bytes.length).set(bytes)
      return [pointer, bytes.length]
    }

    const corrector: RbcopCorrector = {
      correct: (input, config) => {
        let status: number
        try {
          const [sourcePointer, sourceLength] = copyIn(input)
          const [configPointer, configLength] = copyIn(config)
          status = exports.rbcop_correct(sourcePointer, sourceLength, configPointer, configLength)
        } catch (error) {
          // A trap leaves the instance in whatever state the panic did, so it
          // is never used again. Dropping it here is what makes the next call
          // instantiate a fresh one.
          if (current === corrector) current = undefined
          const panic = stderr.splice(0).join('\n').trim()
          throw new Error(`the RuboCop pass crashed on this source${panic ? ` (${panic})` : ''} - please report this`, {
            cause: error,
          })
        }

        const result = decoder.decode(
          new Uint8Array(exports.memory.buffer, exports.rbcop_result_ptr(), exports.rbcop_result_len()),
        )
        if (status !== OK) throw new Error(result)
        return result
      },
    }

    return corrector
  }

  /**
   * Instantiates the module without awaiting, or `undefined` if this engine
   * will not.
   *
   * Under Node, and in a browser worker, this always works and costs a few
   * milliseconds on an already-compiled module. A browser main thread refuses
   * `new WebAssembly.Instance` for a module over 8 MB, and rbcop is 16 MB, so
   * there the caller falls back to the asynchronous path.
   */
  const instantiateSync = (module: WebAssembly.Module): RbcopCorrector | undefined => {
    const pending = prepare()
    let instance: WebAssembly.Instance
    try {
      instance = new WebAssembly.Instance(module, importsFor(pending.wasi))
    } catch {
      return undefined
    }
    return finish(pending, instance)
  }

  const bootSync = (): RbcopCorrector | undefined => {
    if (current) return current

    // `compileSync` throws rather than answering `undefined` when the artifact
    // is missing under Node, and that is the error worth surfacing, so it is
    // left to propagate.
    const module = source.compileSync()
    if (module) current = instantiateSync(module)
    return current
  }

  const boot = async (): Promise<RbcopCorrector> => {
    // The synchronous path first, so that under Node `format` and `formatSync`
    // boot through exactly the same code.
    const ready = bootSync()
    if (ready) return ready

    booting ??= (async () => {
      const module = await source.compile()
      const pending = prepare()
      const instance = await WebAssembly.instantiate(module, importsFor(pending.wasi))
      // Another call may have got there first - a `formatSync` in a worker,
      // once the module had compiled - and that instance stands.
      current ??= finish(pending, instance)
      return current
    })().finally(() => {
      // Not cached past settling either way: on success `current` is the cache,
      // and a failure on a transient problem - a fetch, in the browser - has to
      // stay retryable by calling again.
      booting = undefined
    })

    return booting
  }

  return { boot, bootSync }
}
