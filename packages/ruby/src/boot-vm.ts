import { ConsoleStdout, File, OpenFile, PreopenDirectory, WASI } from '@bjorn3/browser_wasi_shim'
import { RubyVM } from '@ruby/wasm-wasi'

import { STREE_PATCHES } from './stree-patch'
import type { ArtifactSource, BootVm, RubyFormatterVm } from './types'
import { createShimDirectory } from './wasi-shims'

/**
 * The preopened directory the guest reads its input and its config from, and
 * the one `HOME` points at.
 *
 * Exported because three places have to agree on it, and only two of them are
 * in this package: the preopen below, `format.ts`, which writes input into it,
 * and `build/ruby_fmt/preinit.ts`, which maps a real directory here while wizer
 * snapshots the VM. The guest's preopen table is part of that snapshot, so a
 * mismatch does not read as a missing file - it is a VM that cannot see /work
 * at all, and the first RuboCop call dies with `Errno::ENOENT @ dir_s_mkdir`.
 */
export const WORK_DIR = '/work'

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
   * Instantiates the artifact, which arrives with syntax_tree and RuboCop
   * already loaded into it.
   *
   * That is the whole shape of this function now. The artifact is a wizer
   * snapshot of a VM that had already run `ruby-init` and required both gems -
   * see `build/ruby_fmt/preinit.ts` - so booting is an instantiation, the
   * syntax_tree patches and one `ScalarRubyFmt.setup` rather than the ~9s of
   * Ruby it used to be. Formats then reuse
   * the VM, and a recycle costs about what this does instead of paying for the
   * requires again.
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
      // falling back. It points at /work because that is the one directory here
      // that exists and can be written to.
      //
      // Ruby reads the environment once, during `ruby-init`, which now happens
      // at build time - so what actually reaches `ENV` is the environment
      // `preinit.ts` gives wizer, and this is the copy that has to agree with
      // it. It is what an artifact that has not been snapshotted would read,
      // and it is what the snapshot was taken with; keeping the two identical
      // is the point.
      const wasi = new WASI(
        ['ruby'],
        [`HOME=${WORK_DIR}`],
        [
          new OpenFile(new File([])),
          ConsoleStdout.lineBuffered(() => {}),
          ConsoleStdout.lineBuffered(() => {}),
          new PreopenDirectory(WORK_DIR, workFiles),
          createShimDirectory(),
        ],
        // Required: the shim's debug.enable(undefined) resolves to `true`, so
        // omitting this floods stdout with "wasi:" tracing on every syscall.
        { debug: false },
      )

      // Deliberately not `RubyVM.instantiateModule`, which is these four steps
      // plus a fifth: `vm.initialize(args)`, which calls the artifact's
      // `ruby-init` export and then requires /bundle/setup. The snapshot has
      // already been through both, and running `ruby-init` again would
      // reinitialise CRuby underneath the syntax_tree and RuboCop sitting in
      // its heap. So the first four are done here and the fifth is not.
      const vm = new RubyVM()
      const imports = { wasi_snapshot_preview1: wasi.wasiImport }
      vm.addToImports(imports)
      const instance = await WebAssembly.instantiate(await compileArtifact(), imports)
      await vm.setInstance(instance)

      // Hands the shim its instance, and nothing more: wizer runs `_initialize`
      // itself before the snapshot and drops the export, so there is no reactor
      // constructor left here to call twice. Left in rather than replaced with
      // an assignment because it is what makes this work against an artifact
      // that has *not* been snapshotted - useful when bisecting the build.
      //
      // The shim types `initialize` against a narrower instance than
      // `WebAssembly.Instance` - it wants `exports.memory` declared, which the
      // standard type does not carry - so the instance is widened here rather
      // than the shim's expectations being weakened.
      wasi.initialize(instance as unknown as Parameters<typeof wasi.initialize>[0])

      // A handful of correctness fixes on top of the stock gem, applied here
      // rather than in the artifact so they stay reviewable. See stree-patch.ts
      // for what each one fixes and the evidence that it changes nothing else.
      for (const patch of STREE_PATCHES) vm.eval(patch)

      // The one part of the RuboCop setup that cannot be baked in. `ScalarRubyFmt`
      // itself is in the snapshot (see `RUBOCOP_SETUP` in rubocop.ts), but `setup`
      // chdirs into /work and builds the Layout cop set, and both of those belong
      // to a VM rather than to an artifact - a recycled VM starts over on each.
      // It costs ~40ms against the ~8.9s requiring RuboCop used to.
      vm.eval(`ScalarRubyFmt.setup(${JSON.stringify(WORK_DIR)})`)

      current = { vm, workFiles, memory: wasi.inst.exports.memory }
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
   * the only lever we have. It is cheap: the artifact source still has the
   * compiled module cached, so a recycle pays for neither the decompress nor
   * the compile - and since the artifact is pre-initialized, it no longer pays
   * for requiring syntax_tree and RuboCop either. 91ms measured, and 507ms
   * counting the extra work the first format after it does - against the 6,339ms
   * the same pair cost when a fresh VM had to load both gems from scratch.
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
