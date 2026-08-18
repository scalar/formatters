import type { BootModule, ModuleExports, RuntimeSource } from './types'

/**
 * Builds the boot function for one runtime source.
 *
 * The source is a parameter rather than an import because this package has two
 * of them - `load-artifact.ts` reads from disk under Node, `fetch-artifact.ts`
 * fetches in a browser - and the browser build must not so much as mention
 * `node:fs`. Passing the source in is what keeps the two entry points sharing
 * this file instead of duplicating it.
 *
 * Each call closes over its own cache, so the runtime is booted at most once per
 * source per process.
 */
export const createBootModule = (source: RuntimeSource): BootModule => {
  let bootPromise: Promise<ModuleExports> | undefined

  /** The booted exports, readable without awaiting - see `peek`. */
  let current: ModuleExports | undefined

  /**
   * Boots CSharpier compiled to wasm and resolves to the module's exports.
   *
   * The module is booted at most once per process; every later call awaits the
   * same promise, which is what makes `format` milliseconds after the first use.
   */
  const boot = (): Promise<ModuleExports> => {
    bootPromise ??= (async () => {
      // The assets are prepared before the builder runs, because the runtime
      // asks for them synchronously once it starts and the browser source has a
      // fetch to finish first.
      const [dotnet, loadResource] = await Promise.all([source.loadHostBuilder(), source.openResources()])

      const runtime = await dotnet.withDiagnosticTracing(false).withResourceLoader(loadResource).create()

      const main = runtime.getConfig().mainAssemblyName
      if (!main) throw new Error('the .NET runtime booted without naming its main assembly')

      current = await runtime.getAssemblyExports(main)
      return current
    })()

    return bootPromise
  }

  /**
   * The booted exports, or `undefined` if the boot has not finished.
   *
   * This is what `formatSync` is built on: it turns "has the async work already
   * happened" into a question a synchronous caller can ask, instead of one only
   * an `await` can answer.
   */
  const peek = (): ModuleExports | undefined => current

  return { boot, peek }
}
