import { getPHPLoaderModule, jspi } from '@php-wasm/node-8-4'
import { PHP, loadPHPRuntime, setPhpIniEntries } from '@php-wasm/universal'

import { CONFIG_SCRIPT_PATH, FIXER_SCRIPT_PATH, PHAR_PATH, SOURCE_DIR } from './paths'
import { CONFIG_SCRIPT, FIXER_SCRIPT } from './php-scripts'
import { readPhar } from './read-phar'
import type { PhpFormatterRuntime } from './types'

let runtimePromise: Promise<PhpFormatterRuntime> | undefined

/**
 * Boots PHP (wasm) and installs PHP CS Fixer into it. Formats reuse the same
 * instance: the first call costs ~500ms all in, after which formats are
 * ~290ms - the bulk of which is PHP CS Fixer autoloading several hundred
 * classes per request, not the boot.
 *
 * `@php-wasm/node-8-4` and `@php-wasm/universal` rather than the
 * `@php-wasm/node` meta-package they sit under. That package is the documented
 * entry point, and it is the wrong dependency here for two independent reasons.
 * It pulls in `fs-ext-extra-prebuilt`, which ships prebuilt `.node` binaries and
 * runs an install script - both of which this repo exists to avoid - and it
 * depends on every PHP version from 7.4 to 8.5, turning a 66MB install into a
 * 463MB one. Its file locking and WebSocket networking also keep Node's event
 * loop alive, so a process that formats a file and returns simply never exits.
 * The two packages used here have no install scripts and no native binaries.
 *
 * Pinning `node-8-4` is what pins the PHP the fixer runs on, which is why the
 * dependency names a version rather than tracking the newest.
 */
export const bootPhp = (): Promise<PhpFormatterRuntime> => {
  if (runtimePromise) return runtimePromise

  runtimePromise = (async () => {
    // JSPI where the engine has it, Emscripten's asyncify fallback otherwise.
    // Only affects how the runtime suspends, never formatting output.
    const loader = await getPHPLoaderModule((await jspi()) ? 'jspi' : 'asyncify')

    const php = new PHP(
      await loadPHPRuntime(loader, {
        // Required. The runtime asserts on it during init rather than
        // defaulting, because sharing an id across workers would corrupt the
        // file locks it keys on it. Nothing here is concurrent - one instance,
        // one in-memory filesystem - so a constant is correct.
        processId: 1,
        // Emscripten's default is to kill the host process when the guest
        // exits. Throw instead, or a fatal in PHP would take Node down with it.
        quit: (_code: number, error: Error) => {
          throw error
        },
      }),
    )

    // Without this the runtime dies after ~100 formats, and the way it dies is
    // worth spelling out because nothing about it points at the cause: a wasm
    // trap, then every later call failing to write a file with "File descriptor
    // value too large".
    //
    // PHP CS Fixer's `Config` constructor calls `ParallelConfigFactory::detect()`,
    // which asks fidry/cpu-core-counter how many cores there are. Most of its
    // finders shell out - `nproc`, `lscpu`, `sysctl` - through `proc_open`. In
    // wasm there are no subprocesses, so every one of those attempts fails, but
    // the pipes it opened are not reclaimed, and the guest's descriptor table
    // fills up a little on each request. `FixCommand` constructs a `Config`
    // eagerly, so this happens on every single format, whatever the input.
    //
    // Disabling the functions makes the finders fail before they open anything.
    // Detection then falls through to the counter's own fallback and reports one
    // core, which is what we want anyway: a single file has nothing to
    // parallelise, and PHP CS Fixer runs sequentially either way. So this costs
    // no behaviour - the conformance test formats the same bytes with it on.
    await setPhpIniEntries(php, {
      disable_functions: 'proc_open,popen,shell_exec,exec,passthru,system,proc_close,proc_get_status',
    })

    php.mkdirTree(SOURCE_DIR)
    php.writeFile(PHAR_PATH, readPhar())
    php.writeFile(CONFIG_SCRIPT_PATH, CONFIG_SCRIPT)
    php.writeFile(FIXER_SCRIPT_PATH, FIXER_SCRIPT)

    return { php }
  })()

  return runtimePromise
}
