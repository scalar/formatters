import { ConsoleStdout, type Directory, File, OpenFile, PreopenDirectory, WASI } from '@bjorn3/browser_wasi_shim'
import { RubyVM } from '@ruby/wasm-wasi'

import { applySnapshot } from './apply-snapshot'
import { RUBOCOP_SETUP } from './rubocop'
import { fingerprintBootSteps } from './snapshot'
import { STREE_PATCHES } from './stree-patch'
import type { ArtifactSource, BootVm, RubyFormatterVm, SnapshotSource } from './types'
import { SHIM_MOUNT_PATH, createShimDirectory } from './wasi-shims'

/** The preopened directory the guest reads its input and its config from. */
export const WORK_DIR = '/work'

/**
 * The Ruby that turns a bare CRuby into this package's formatter.
 *
 * Shared between the two boot paths on purpose: `build/ruby_fmt/write-snapshot.ts`
 * runs exactly this to produce the snapshot, and the slow path runs exactly this
 * when there is no snapshot to run instead. One definition is what makes those
 * two roads lead to the same VM.
 */
export const BOOT_STEPS = {
  /**
   * RubyGems is required explicitly because Ruby 4.0 stopped loading it during
   * startup. `Gem` is still defined - as a stub - so nothing fails until
   * something touches a real constant, which syntax_tree does on the second
   * line of `formatter.rb`: `Gem::Version.new(RUBY_VERSION)`. The error that
   * came back was `uninitialized constant Gem::Version`, which reads like a
   * broken artifact rather than a missing require.
   *
   * /bundle/setup puts the baked-in gems on the load path. rbwasm writes it
   * when it packages the Gemfile, and nothing else sets $LOAD_PATH up for us.
   *
   * The shims go on the end, never the front: the real stdlib is searched
   * first, so they answer only for the two extensions this build genuinely
   * does not have. See `wasi-shims.ts`.
   */
  syntaxTree: `require "rubygems"; require "/bundle/setup"; $LOAD_PATH.push("${SHIM_MOUNT_PATH}"); require "syntax_tree"`,
  /** Correctness fixes on top of the stock gem - see `stree-patch.ts`. */
  patches: STREE_PATCHES,
  /** RuboCop, and the Layout pass built over it - see `rubocop.ts`. */
  rubocop: RUBOCOP_SETUP,
  /** Builds the cop set, once, in a directory that exists. */
  rubocopSetup: `ScalarRubyFmt.setup(${JSON.stringify(WORK_DIR)})`,
} as const

/**
 * Every line of Ruby a boot runs, in order, as one flat list.
 *
 * Exists so that {@link fingerprintBootSteps} has something to hash and
 * `build/ruby_fmt/write-snapshot.ts` has something to iterate. Both matter: an
 * image is only interchangeable with a boot if it was taken from *this* Ruby.
 */
export const BOOT_SCRIPTS: readonly string[] = [
  BOOT_STEPS.syntaxTree,
  ...BOOT_STEPS.patches,
  BOOT_STEPS.rubocop,
  BOOT_STEPS.rubocopSetup,
]

/** What a snapshot's `bootSteps` has to say for it to be usable here. */
export const BOOT_FINGERPRINT = fingerprintBootSteps(BOOT_SCRIPTS)

/**
 * Builds the WASI environment a VM runs in.
 *
 * The fd order is load-bearing twice over. fds 0/1/2 are stdin/stdout/stderr
 * and preopened directories start at fd 3, so a directory in one of the first
 * three slots would silently become stdio. And wasi-libc caches the fd-to-path
 * mapping in linear memory the first time a path is opened, which means a VM
 * restored from a snapshot has already decided that fd 3 is /work and fd 4 is
 * the shim directory - so this must build them in the same order every time.
 *
 * HOME is set because RuboCop asks for it: `Dir.home` backs its cache root, and
 * with no HOME in the environment that raises rather than falling back. It
 * points at /work because that is the one directory here that exists and can be
 * written to.
 */
export const createWasi = (workFiles: Map<string, Directory | File>): WASI =>
  new WASI(
    ['ruby'],
    ['HOME=/work'],
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

/**
 * Builds the boot/recycle pair for one artifact source.
 *
 * The sources are parameters rather than imports because this package has two
 * of each - `compile-artifact.ts` and `read-snapshot.ts` read from disk under
 * Node, `fetch-artifact.ts` and `fetch-snapshot.ts` fetch in a browser - and the
 * browser build must not so much as mention `node:fs`. Passing them in is what
 * keeps the two entry points sharing this file instead of duplicating it.
 *
 * Each call closes over its own cache, so the VM is booted at most once per
 * source per process.
 */
export const createBootVm = (compileArtifact: ArtifactSource, loadSnapshot?: SnapshotSource): BootVm => {
  let vmPromise: Promise<RubyFormatterVm> | undefined

  /** The live VM, readable without awaiting - see `peek`. */
  let current: RubyFormatterVm | undefined

  /**
   * Boots from the snapshot: instantiate, restore, done.
   *
   * Deliberately *not* calling `wasip1.initialize` or `vm.initialize` - CRuby's
   * own startup and every `require` on top of it are the work the image already
   * contains, and running them over a restored memory would mix two VMs' state.
   * `vm.setInstance` is still needed, because that is the JavaScript side of the
   * bridge and lives in this process rather than in the image.
   *
   * Returns `undefined` rather than throwing when the restored VM does not
   * answer as expected, so a snapshot that cannot be trusted costs a slow boot
   * and nothing else.
   */
  const bootFromSnapshot = async (module: WebAssembly.Module): Promise<RubyFormatterVm | undefined> => {
    const snapshot = await loadSnapshot?.().catch(() => undefined)

    // A snapshot built from different Ruby is worse than no snapshot: it would
    // boot to the old behaviour while the fallback path booted to the new, and
    // nothing downstream could tell which one it got.
    if (!snapshot || snapshot.bootSteps !== BOOT_FINGERPRINT) return undefined

    try {
      const workFiles = new Map<string, Directory | File>()
      const wasi = createWasi(workFiles)

      const vm = new RubyVM()
      const imports = { wasi_snapshot_preview1: wasi.wasiImport }
      vm.addToImports(imports)

      const instance = await WebAssembly.instantiate(module, imports)
      await vm.setInstance(instance)

      // `wasi.initialize(instance)` would do this and then call `_initialize`,
      // which is part of what the image replaces. The memory is all the shim
      // itself wants from an instance, so hand it that and nothing else.
      const memory = instance.exports['memory'] as WebAssembly.Memory
      wasi.inst = { exports: { memory } }

      applySnapshot(memory, workFiles, snapshot)

      // The image is only worth using if the VM it produced is the one we meant
      // to take. Asking Ruby proves the memory landed where the code expects it,
      // which no amount of header checking can.
      if (vm.eval('defined?(SyntaxTree) && defined?(ScalarRubyFmt) ? 1 : 0').toString() !== '1') return undefined

      return { vm, workFiles, memory, bootBytes: memory.buffer.byteLength, rubocopLoaded: true }
    } catch {
      return undefined
    }
  }

  /**
   * Boots CRuby (wasm) and loads syntax_tree into it the long way round.
   *
   * This is what the snapshot exists to skip, and what runs when there is no
   * usable snapshot. RuboCop is not required here: it costs eight seconds or
   * more against syntax_tree's one, and a caller who never asks for it should
   * never wait for it, so `format.ts` loads it on first use and flips the flag.
   *
   * `@bjorn3/browser_wasi_shim` rather than `node:wasi` on purpose. Node's built-in
   * WASI segfaults non-deterministically once ruby.wasm is given preopened
   * directories — measured at 2 failures in 6 runs on identical input — and we
   * need a preopen to hand Ruby its input. The shim is pure JavaScript, so it
   * costs nothing at install time and keeps the guest filesystem in memory
   * instead of on disk. Carrying no Node built-ins of its own, it is also what
   * makes the browser build possible at all.
   */
  const bootFromSource = async (module: WebAssembly.Module): Promise<RubyFormatterVm> => {
    const workFiles = new Map<string, Directory | File>()
    const wasi = createWasi(workFiles)

    const { vm } = await RubyVM.instantiateModule({ module, wasip1: wasi })

    vm.eval(BOOT_STEPS.syntaxTree)
    for (const patch of BOOT_STEPS.patches) vm.eval(patch)

    const memory = wasi.inst.exports.memory
    return { vm, workFiles, memory, bootBytes: memory.buffer.byteLength, rubocopLoaded: false }
  }

  const boot = (): Promise<RubyFormatterVm> => {
    if (vmPromise) return vmPromise

    vmPromise = (async () => {
      const module = await compileArtifact()
      current = (await bootFromSnapshot(module)) ?? (await bootFromSource(module))
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
   * This exists because formatting grows the VM's linear memory (see
   * `format.ts`); dropping the VM is the only lever we have. It is cheap
   * relative to a cold start, because both sources still have their results
   * cached — a recycle pays for the boot alone, not another decompress and
   * compile.
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
