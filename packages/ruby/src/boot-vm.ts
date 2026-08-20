import { ConsoleStdout, File, OpenFile, PreopenDirectory, WASI } from '@bjorn3/browser_wasi_shim'
import { RubyVM } from '@ruby/wasm-wasi'

import { IN_PATTERN_THEN_PATCH } from './stree-patch'
import type { ArtifactSource, BootVm, RubyFormatterVm } from './types'
import { SHIM_MOUNT_PATH, createShimDirectory } from './wasi-shims'

/**
 * Builds the boot/recycle pair for one artifact source.
 *
 * The source is a parameter rather than an import because this package has two
 * of them - `compile-artifact.ts` reads the file from disk under Node,
 * `fetch-artifact.ts` fetches it over HTTP in a browser - and the browser build
 * must not so much as mention `node:fs`. Passing the source in is what keeps
 * the two entry points sharing this file instead of duplicating it.
 *
 * Each call closes over its own cache, so the VM is booted at most once per
 * source per process.
 */
export const createBootVm = (compileArtifact: ArtifactSource): BootVm => {
  let vmPromise: Promise<RubyFormatterVm> | undefined

  /** The live VM, readable without awaiting - see `peek`. */
  let current: RubyFormatterVm | undefined

  /**
   * Boots CRuby (wasm) and loads syntax_tree into it. Formats reuse the same VM:
   * the first call costs ~1.1s all in and dominates everything else, after which
   * formats are ~4ms.
   *
   * `@bjorn3/browser_wasi_shim` rather than `node:wasi` on purpose. Node's built-in
   * WASI segfaults non-deterministically once ruby.wasm is given preopened
   * directories — measured at 2 failures in 6 runs on identical input — and we
   * need a preopen to hand Ruby its input. The shim is pure JavaScript, so it
   * costs nothing at install time and keeps the guest filesystem in memory
   * instead of on disk. Carrying no Node built-ins of its own, it is also what
   * makes the browser build possible at all.
   */
  const boot = (): Promise<RubyFormatterVm> => {
    if (vmPromise) return vmPromise

    vmPromise = (async () => {
      const workFiles = new Map<string, File>()

      // fds 0/1/2 are stdin/stdout/stderr; preopened dirs start at fd 3. Passing
      // a directory in one of the first three slots silently makes it stdio.
      //
      // HOME is set because RuboCop asks for it: `Dir.home` backs its cache
      // root, and with no HOME in the environment that raises rather than
      // falling back. It points at /work because that is the one directory
      // here that exists and can be written to.
      const wasi = new WASI(
        ['ruby'],
        ['HOME=/work'],
        [
          new OpenFile(new File([])),
          ConsoleStdout.lineBuffered(() => {}),
          ConsoleStdout.lineBuffered(() => {}),
          new PreopenDirectory('/work', workFiles),
          createShimDirectory(),
        ],
        // Required: the shim's debug.enable(undefined) resolves to `true`, so
        // omitting this floods stdout with "wasi:" tracing on every syscall.
        { debug: false },
      )

      const { vm } = await RubyVM.instantiateModule({ module: await compileArtifact(), wasip1: wasi })

      // /bundle/setup puts the baked-in gems on the load path. rbwasm writes it
      // when it packages the Gemfile, and nothing else sets $LOAD_PATH up for us.
      //
      // The shims go on the end, never the front: the real stdlib is searched
      // first, so they answer only for the two extensions this build genuinely
      // does not have. See `wasi-shims.ts`.
      vm.eval(`require "/bundle/setup"; $LOAD_PATH.push("${SHIM_MOUNT_PATH}"); require "syntax_tree"`)

      // One correctness fix on top of the stock gem, applied here rather than in
      // the artifact so it stays reviewable. See stree-patch.ts for what it fixes
      // and the evidence that it changes nothing else.
      vm.eval(IN_PATTERN_THEN_PATCH)

      // RuboCop is not required here. It costs about four seconds against
      // syntax_tree's one, and a caller who never asks for it should never wait
      // for it, so `format.ts` loads it on first use and flips this.
      current = { vm, workFiles, memory: wasi.inst.exports.memory, rubocopLoaded: false }
      return current
    })().catch((error: unknown) => {
      // The rejection is not cached, so a boot that failed on a transient
      // problem can be retried by calling again rather than sticking for the
      // process.
      vmPromise = undefined
      throw error
    })

    return vmPromise
  }

  /**
   * Drops the cached VM and boots a fresh one.
   *
   * This exists because formatting leaks (see `format.ts`); dropping the VM is
   * the only lever we have. It is cheap relative to a cold start, because the
   * artifact source still has the compiled module cached — a recycle pays for
   * the boot alone, not another decompress and compile.
   */
  const recycle = (): Promise<RubyFormatterVm> => {
    vmPromise = undefined
    current = undefined
    return boot()
  }

  /**
   * The booted VM, or `undefined` if the boot has not finished.
   *
   * This is what `formatSync` is built on: it turns "has the async work already
   * happened" into a question a synchronous caller can ask, instead of one only
   * an `await` can answer.
   */
  const peek = (): RubyFormatterVm | undefined => current

  return { boot, peek, recycle }
}
