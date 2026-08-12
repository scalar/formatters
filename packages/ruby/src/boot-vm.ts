import { ConsoleStdout, File, OpenFile, PreopenDirectory, WASI } from '@bjorn3/browser_wasi_shim'
import { RubyVM } from '@ruby/wasm-wasi'

import { compileArtifact } from './compile-artifact'
import { IN_PATTERN_THEN_PATCH } from './stree-patch'
import type { RubyFormatterVm } from './types'

let vmPromise: Promise<RubyFormatterVm> | undefined

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
 * instead of on disk.
 */
export const bootVm = (): Promise<RubyFormatterVm> => {
  if (vmPromise) return vmPromise

  vmPromise = (async () => {
    const workFiles = new Map<string, File>()

    // fds 0/1/2 are stdin/stdout/stderr; preopened dirs start at fd 3. Passing
    // a directory in one of the first three slots silently makes it stdio.
    const wasi = new WASI(
      ['ruby'],
      [],
      [
        new OpenFile(new File([])),
        ConsoleStdout.lineBuffered(() => {}),
        ConsoleStdout.lineBuffered(() => {}),
        new PreopenDirectory('/work', workFiles),
      ],
      // Required: the shim's debug.enable(undefined) resolves to `true`, so
      // omitting this floods stdout with "wasi:" tracing on every syscall.
      { debug: false },
    )

    const { vm } = await RubyVM.instantiateModule({ module: compileArtifact(), wasip1: wasi })

    // /bundle/setup puts the baked-in gems on the load path. rbwasm writes it
    // when it packages the Gemfile, and nothing else sets $LOAD_PATH up for us.
    vm.eval('require "/bundle/setup"; require "syntax_tree"')

    // One correctness fix on top of the stock gem, applied here rather than in
    // the artifact so it stays reviewable. See stree-patch.ts for what it fixes
    // and the evidence that it changes nothing else.
    vm.eval(IN_PATTERN_THEN_PATCH)

    return { vm, workFiles, memory: wasi.inst.exports.memory }
  })()

  return vmPromise
}

/**
 * Drops the cached VM and boots a fresh one.
 *
 * This exists because formatting leaks (see `format.ts`); dropping the VM is
 * the only lever we have. It is cheap relative to a cold start, because
 * `compileArtifact` still has the compiled module cached — a recycle pays for
 * the boot alone, not another decompress and compile.
 */
export const recycleVm = (): Promise<RubyFormatterVm> => {
  vmPromise = undefined
  return bootVm()
}
