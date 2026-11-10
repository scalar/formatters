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

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/**
 * Builds the boot/peek pair for rbcop, the RuboCop Layout pass.
 *
 * rbcop is RuboCop 1.92.2 reimplemented in Rust and compiled to a WASI reactor
 * (see build/rbcop_fmt). One instance is booted and reused: it keeps every
 * config it has resolved, and resolving one - merging it over RuboCop's own
 * default.yml - is ~30x what a Layout pass on a typical file costs.
 *
 * Through `@bjorn3/browser_wasi_shim`, like the Ruby VM, so that the Node and
 * browser builds run the same code over an in-memory filesystem.
 *
 * Unlike the Ruby VM, the instance does not leak: Rust frees what a format
 * allocates. The one thing that ends an instance is a trap. Rust panics abort
 * on wasm, so a panic inside rbcop leaves the instance unusable; the trap is
 * reported as an error and the next `boot` instantiates a fresh one.
 */
export const createRbcop = (compileArtifact: ArtifactSource): RbcopBoot => {
  let promise: Promise<RbcopCorrector> | undefined
  let current: RbcopCorrector | undefined

  const instantiate = async (): Promise<RbcopCorrector> => {
    // stderr is kept, because it is where a Rust panic prints its message, and
    // that message is the only useful thing to say when the instance traps.
    const stderr: string[] = []
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

    const instance = await WebAssembly.instantiate(await compileArtifact(), {
      wasi_snapshot_preview1: wasi.wasiImport,
    })
    // Runs the reactor's `_initialize`, which is the C constructors and Rust's
    // runtime setup, exactly once.
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
      correct: (source, config) => {
        let status: number
        try {
          const [sourcePointer, sourceLength] = copyIn(source)
          const [configPointer, configLength] = copyIn(config)
          status = exports.rbcop_correct(sourcePointer, sourceLength, configPointer, configLength)
        } catch (error) {
          // A trap leaves the instance in whatever state the panic did, so it
          // is never used again. Dropping it here is what makes the next boot
          // instantiate a fresh one.
          if (current === corrector) {
            current = undefined
            promise = undefined
          }
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

    current = corrector
    return corrector
  }

  const boot = (): Promise<RbcopCorrector> => {
    promise ??= instantiate().catch((error: unknown) => {
      // Not cached, so a boot that failed on a transient problem - a fetch, in
      // the browser - can be retried by calling again.
      promise = undefined
      throw error
    })
    return promise
  }

  return { boot, peek: () => current }
}
