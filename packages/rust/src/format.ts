import { File } from '@bjorn3/browser_wasi_shim'

import { bootModule, recycleModule } from './boot-module'
import type { FormatOptions } from './types'

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
 * Formats Rust source with rustfmt compiled to WebAssembly.
 *
 * The first call decompresses, compiles and boots the module (~150ms); later
 * calls reuse it and take a few milliseconds.
 *
 * Options are rustfmt's own configuration keys and anything omitted keeps
 * rustfmt's default. Note that a `rustfmt.toml` on disk is *not* consulted - the
 * module has no filesystem to search - so a project's configuration has to be
 * read and passed in by the caller.
 */
export const format = async (source: string, options: FormatOptions = {}): Promise<string> => {
  const { run, workFiles, diagnostics } = await bootModule()

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
    recycleModule()
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
