import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { RUNTIME_ENTRY, openArchive } from './load-artifact'
import type { ModuleExports } from './types'

/** What `dotnet.js` exposes, narrowed to the handful of calls used here. */
type HostBuilder = {
  withDiagnosticTracing: (enabled: boolean) => HostBuilder
  withResourceLoader: (load: ResourceLoader) => HostBuilder
  create: () => Promise<RuntimeApi>
}

/**
 * The runtime's hook for supplying an asset itself rather than fetching it.
 *
 * Returning `undefined` means "load it the normal way", which is what the four
 * JavaScript files need - they are imported as ES modules by URL, so bytes are
 * no use to the runtime for those.
 */
type ResourceLoader = (type: string, name: string, defaultUri: string) => Promise<Response> | undefined

type RuntimeApi = {
  getAssemblyExports: (assembly: string) => Promise<ModuleExports>
  getConfig: () => { mainAssemblyName?: string }
}

let bootPromise: Promise<ModuleExports> | undefined

/**
 * Boots CSharpier compiled to wasm and resolves to the module's exports.
 *
 * The module is booted at most once per process; every later call awaits the
 * same promise, which is what makes `format` milliseconds after the first use.
 */
export const bootModule = async (): Promise<ModuleExports> => {
  if (bootPromise) return bootPromise

  bootPromise = (async () => {
    const archive = openArchive()

    // Imported by URL rather than by path because this file is ESM and the
    // runtime lives outside `dist`; a bare relative specifier would resolve
    // against the wrong directory once the package is installed.
    const { dotnet } = (await import(pathToFileURL(RUNTIME_ENTRY).href)) as {
      dotnet: HostBuilder
    }

    const runtime = await dotnet
      .withDiagnosticTracing(false)
      // Every assembly, the runtime wasm and the ICU data come from the archive
      // instead of from disk. The runtime asks by asset name; `defaultUri` is
      // the fallback for the rare entry whose name is a path.
      .withResourceLoader((_type, name, defaultUri) => {
        const bytes = archive.read(name) ?? archive.read(path.basename(defaultUri ?? ''))
        return bytes ? Promise.resolve(new Response(bytes)) : undefined
      })
      .create()

    const main = runtime.getConfig().mainAssemblyName
    if (!main) throw new Error('the .NET runtime booted without naming its main assembly')

    return runtime.getAssemblyExports(main)
  })()

  return bootPromise
}
