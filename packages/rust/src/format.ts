import { File } from '@bjorn3/browser_wasi_shim'

import { createBootModule } from './boot-module'
import type { ArtifactSource, FormatOptions, Formatters, RustFormatModule } from './types'

/** Statuses the Rust side returns. See build/rust_fmt/crates/rust_fmt/src/lib.rs. */
const STATUS_OK = 0
const STATUS_BAD_CONFIG = 2
const STATUS_FORMAT_FAILED = 3

/**
 * rustfmt spells its options in snake_case and this package's type spells them
 * in camelCase, which is the only difference between them - so the names are
 * converted rather than listed in a table that would have to be kept in step
 * with `FormatOptions`. Unknown keys are rejected by rustfmt's own validator on
 * the other side, so a name that fails to round-trip surfaces as an error
 * naming the key rather than as silently ignored configuration.
 */
const toRustfmtKey = (key: string): string => key.replace(/[A-Z]/g, (upper) => `_${upper.toLowerCase()}`)

/**
 * Renders options as the `key=value` lines the module reads.
 *
 * `config` is applied after the typed fields so that it can override them,
 * which is what makes it a usable escape hatch rather than a second, competing
 * source of truth.
 */
const renderConfig = (options: FormatOptions): string => {
  const { config, ...typed } = options
  const pairs = new Map<string, string>()

  for (const [key, value] of Object.entries(typed)) {
    if (value !== undefined) pairs.set(toRustfmtKey(key), String(value))
  }
  for (const [key, value] of Object.entries(config ?? {})) {
    if (value !== undefined) pairs.set(key, String(value))
  }

  return Array.from(pairs, ([key, value]) => `${key}=${value}`).join('\n')
}

/**
 * Formats one source through an already-booted module.
 *
 * Every step here is synchronous, which is the whole reason `formatSync` can
 * exist: the only asynchronous thing this package ever does is get the wasm
 * compiled and instantiated, and by the time this runs that has happened.
 */
const formatThrough = (
  booted: RustFormatModule,
  recycle: () => RustFormatModule | undefined,
  source: string,
  options: FormatOptions,
): string => {
  const { run, workFiles, diagnostics } = booted

  const encoder = new TextEncoder()
  workFiles.set('input.rs', new File(encoder.encode(String(source))))
  workFiles.set('config', new File(encoder.encode(renderConfig(options))))
  workFiles.delete('output.rs')
  diagnostics.length = 0

  let status: number
  try {
    status = run()
  } catch (error) {
    // A trap leaves the module mid-call, so this instance is finished - every
    // later call on it would inherit whatever state it died in. The likeliest
    // cause by far is source nested deeply enough to exhaust the module's
    // stack, which is worth reporting as itself rather than as a bare
    // RuntimeError.
    recycle()
    throw new Error(
      "rustfmt crashed while formatting. This is usually deeply nested source exhausting the module's stack. " +
        `(${error instanceof Error ? error.message : String(error)})`,
    )
  }

  if (status !== STATUS_OK) {
    const detail = diagnostics.join('\n').replace(/^rust_fmt: /gm, '')
    if (status === STATUS_BAD_CONFIG) {
      throw new Error(detail || 'rustfmt rejected the configuration')
    }
    if (status === STATUS_FORMAT_FAILED) {
      throw new Error(detail || 'rustfmt could not parse the source')
    }
    throw new Error(detail || `rustfmt failed with status ${status}`)
  }

  const output = workFiles.get('output.rs') as File | undefined
  if (!output) throw new Error('rustfmt reported success but produced no output')

  return new TextDecoder().decode(output.data)
}

/**
 * Builds the package's public functions over one artifact source.
 *
 * The entry points call this: `index.ts` with the source that reads the wasm
 * from disk, `index.browser.ts` with the one that fetches it. Everything below
 * this line is identical either way, which is the point - the environment
 * difference is confined to how the bytes arrive.
 */
export const createFormat = (compileArtifact: ArtifactSource): Formatters => {
  const { boot, peek, recycle } = createBootModule(compileArtifact)

  /**
   * Formats Rust source with rustfmt compiled to WebAssembly.
   *
   * The first call decompresses, compiles and boots the module (~150ms under
   * Node, ~600ms in a browser where the decompression is not native); later
   * calls reuse it and take a few milliseconds.
   *
   * Options are rustfmt's own configuration keys and anything omitted keeps
   * rustfmt's default. Note that a `rustfmt.toml` on disk is *not* consulted - the
   * module has no filesystem to search - so a project's configuration has to be
   * read and passed in by the caller.
   */
  const format = async (source: string, options: FormatOptions = {}): Promise<string> =>
    formatThrough(await boot(), recycle, source, options)

  /**
   * Formats Rust source without awaiting, for callers that cannot.
   *
   * Same rustfmt, same options, same bytes out as `format` - the only difference
   * is that this one refuses to wait. Booting is asynchronous no matter what
   * (the wasm has to be fetched or read, and compiled), so this throws until
   * that has happened. Call `init` once, then this as often as you like:
   *
   * ```ts
   * await init()
   * formatSync('pub fn add(a: i32,b:i32)->i32{a+b}')
   * ```
   *
   * This exists for callers whose seams are synchronous all the way down - a
   * code generator that formats each file inside the builder that emits it, a
   * template renderer, a plugin hook that has to return a string. Prefer
   * `format` anywhere you can await: it needs no setup call and cannot throw
   * this error.
   */
  const formatSync = (source: string, options: FormatOptions = {}): string => {
    const booted = peek()
    if (!booted) {
      throw new Error(
        'the module is not ready to format synchronously. Await init() once before the first formatSync - ' +
          'or again after a trap this environment could not recover from without awaiting - or use the async ' +
          'format() instead, which waits on its own.',
      )
    }

    return formatThrough(booted, recycle, source, options)
  }

  /**
   * Boots the module, so that `formatSync` can be called afterwards.
   *
   * Optional for `format`, which boots on demand, and required exactly once
   * before `formatSync`. Awaiting it twice is harmless - the boot is cached, so
   * the second call resolves against the first.
   */
  const init = async (): Promise<void> => {
    await boot()
  }

  return { format, formatSync, init }
}
