/**
 * Options accepted by `format`. Each one mirrors a CSharpier configuration key,
 * and every default is the tool's own default rather than one we picked - the
 * package is the tool, so `format(source)` has to mean what `csharpier format
 * <file>` means for a file with no `.csharpierrc` next to it.
 */
export type FormatOptions = {
  /** Column the printer tries to stay inside. CSharpier's `printWidth`, default 100. */
  printWidth?: number
  /** Indent with tabs instead of spaces. CSharpier's `useTabs`, default false. */
  useTabs?: boolean
  /** Spaces per indent level, ignored when `useTabs` is set. CSharpier's `indentSize`, default 4. */
  indentSize?: number
  /**
   * Line ending to print. CSharpier's `endOfLine`, default `auto`, which takes
   * its cue from the first line ending in the input and falls back to `lf`.
   */
  endOfLine?: 'auto' | 'lf' | 'crlf'
}

/**
 * The function the wasm module exports, as `[JSExport]` presents it.
 *
 * Options cross as separate primitives rather than an object because the .NET
 * JavaScript interop marshals `int`, `bool` and `string` natively, while
 * reading typed fields off a JSObject would cost more C# for no gain.
 *
 * The result carries a leading status character - see `format`.
 */
export type FormatFunction = (
  source: string,
  printWidth: number,
  useTabs: boolean,
  indentSize: number,
  endOfLine: string,
) => string

/** The shape of `getAssemblyExports` output that we actually use. */
export type ModuleExports = {
  CSharpFmt: { Format: FormatFunction }
}

/**
 * An asset the runtime can ask for, located inside the decompressed archive.
 *
 * `Uint8Array` rather than `Buffer` because both environments index the same
 * layout and only one of them has `Buffer` - a `Buffer` satisfies this anyway,
 * being one.
 */
export type Archive = {
  read: (name: string) => Uint8Array | undefined
}

/**
 * The runtime's hook for supplying an asset itself rather than fetching it.
 *
 * Three possible answers, and the runtime treats each differently:
 * a `Response` hands over bytes, a `string` is taken as a URL to load from, and
 * `undefined` means "load it the normal way". The JS halves of the runtime are
 * imported as ES modules and so can only be pointed at, never handed bytes -
 * which is exactly why a `string` is in this union.
 */
export type ResourceLoader = (type: string, name: string, defaultUri: string) => Promise<Response> | string | undefined

/** What `dotnet.js` exposes, narrowed to the handful of calls used here. */
export type HostBuilder = {
  withDiagnosticTracing: (enabled: boolean) => HostBuilder
  withResourceLoader: (load: ResourceLoader) => HostBuilder
  create: () => Promise<RuntimeApi>
}

/** The booted runtime, narrowed to what `bootModule` reads off it. */
export type RuntimeApi = {
  getAssemblyExports: (assembly: string) => Promise<ModuleExports>
  getConfig: () => { mainAssemblyName?: string }
}

/**
 * Everything about booting the .NET runtime that depends on the environment.
 *
 * There are two implementations - `load-artifact.ts` reads from disk under Node,
 * `fetch-artifact.ts` fetches in a browser - and this is the whole of the
 * difference between them. `openResources` is async and separate from
 * `loadResource` because the browser has to have the archive in hand before the
 * runtime starts asking for assets synchronously.
 */
export type RuntimeSource = {
  /** Imports `dotnet.js` and hands back its host builder. */
  loadHostBuilder: () => Promise<HostBuilder>
  /** Prepares the assets, resolving to the hook the runtime will call per asset. */
  openResources: () => Promise<ResourceLoader>
}

/** The package's asynchronous entry point, exported by both builds as `format`. */
export type Formatter = (source: string, options?: FormatOptions) => Promise<string>

/**
 * The package's synchronous entry point, exported by both builds as `formatSync`.
 *
 * Usable only once `init` has resolved, because booting cannot be made
 * synchronous - the assemblies have to be read or fetched, and the runtime
 * started - and throws with that instruction until then.
 */
export type FormatterSync = (source: string, options?: FormatOptions) => string

/** What `createFormat` returns: the package's public functions over one runtime source. */
export type Formatters = {
  format: Formatter
  formatSync: FormatterSync
  init: () => Promise<void>
}

/**
 * The lifecycle `createBootModule` hands back.
 *
 * `peek` is what makes a synchronous format possible: it answers "is the runtime
 * ready" without an await, so a synchronous caller can be told to init rather
 * than being handed a promise it cannot use.
 */
export type BootModule = {
  boot: () => Promise<ModuleExports>
  peek: () => ModuleExports | undefined
}

/**
 * Options for the browser build's `init`, which is the seam for telling the
 * package where its assets live. Every field is optional; the defaults resolve
 * `csharp_fmt.br` and the four `runtime/*.js` files relative to the module.
 */
export type InitOptions = {
  /** Where to fetch the archive from. Defaults to the `.br` beside this package. */
  url?: string | URL
  /** The archive itself, already in hand. Skips the fetch entirely. */
  bytes?: ArrayBuffer | ArrayBufferView
  /**
   * How the bytes at `url` are encoded. Defaults to `brotli`, matching the
   * committed archive. Use `none` when the server sets `Content-Encoding: br`
   * - the browser will have expanded it before this package sees it - or when
   * `url` points at an uncompressed archive. Either skips the decoder, and with
   * it the 208KB download on engines without native brotli.
   */
  encoding?: 'brotli' | 'none'
  /**
   * Where the four `runtime/*.js` files are served from, without a trailing
   * slash. They are ES modules the .NET runtime imports by URL, so unlike every
   * other asset they cannot be handed over as bytes.
   *
   * The default resolves them next to this module, which is the form Vite,
   * Rollup and webpack recognise - each is emitted as an asset and the URL
   * rewritten - so this is only needed when they end up somewhere those cannot
   * derive, or under esbuild, which leaves `new URL` alone.
   */
  runtimeBaseUrl?: string | URL
}
