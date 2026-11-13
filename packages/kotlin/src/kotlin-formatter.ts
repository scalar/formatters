import type { ArtifactSource, FormatOptions, KotlinFormatter, KotlinFormatterBoot } from './types'

/** What `kotlin_fmt_format` returns when the result is formatted source. */
const OK = 0

/**
 * What an integer argument means when it is negative: "whatever the chosen
 * style says". The presets stay authoritative, and this side never restates
 * one of ktfmt's defaults.
 */
const INHERIT = -1

/** The module's exports, as build/kotlin_fmt/entry/src/lib.rs defines them. */
type KotlinFmtExports = {
  memory: WebAssembly.Memory
  kotlin_fmt_alloc: (length: number) => number
  kotlin_fmt_format: (
    source: number,
    sourceLength: number,
    style: number,
    maxWidth: number,
    blockIndent: number,
    continuationIndent: number,
    trailingCommas: number,
    removeUnusedImports: number,
    preserveLambdaBreaks: number,
  ) => number
  kotlin_fmt_result_ptr: () => number
  kotlin_fmt_result_len: () => number
}

const STYLES: Record<NonNullable<FormatOptions['style']>, number> = { meta: 0, google: 1, kotlinlang: 2 }

const TRAILING_COMMAS: Record<NonNullable<FormatOptions['trailingCommas']>, number> = {
  none: 0,
  onlyAdd: 1,
  complete: 2,
}

/** `kotlin_fmt_format`'s arguments after the source, in its order. */
type EncodedOptions = [
  style: number,
  maxWidth: number,
  blockIndent: number,
  continuationIndent: number,
  trailingCommas: number,
  removeUnusedImports: number,
  preserveLambdaBreaks: number,
]

const integer = (value: number | undefined): number => (value === undefined ? INHERIT : value)
const flag = (value: boolean | undefined): number => (value === undefined ? INHERIT : Number(value))

/**
 * The options as the integers `kotlin_fmt_format` takes, in its order.
 *
 * Checked here, because the module reads any negative number as "inherit" and
 * an unknown style as meta: a typo would otherwise be formatted with a default
 * and look like it had worked.
 */
const encodeOptions = (options: FormatOptions): EncodedOptions => {
  const style = STYLES[options.style ?? 'meta']
  if (style === undefined) throw new TypeError(`unknown style ${JSON.stringify(options.style)}`)

  const trailingCommas = options.trailingCommas === undefined ? INHERIT : TRAILING_COMMAS[options.trailingCommas]
  if (trailingCommas === undefined) {
    throw new TypeError(`unknown trailingCommas ${JSON.stringify(options.trailingCommas)}`)
  }

  for (const key of ['maxWidth', 'blockIndent', 'continuationIndent'] as const) {
    const value = options[key]
    if (value !== undefined && !(Number.isInteger(value) && value >= 0 && value <= 0x7fffffff)) {
      throw new TypeError(`${key} must be a non-negative integer, not ${String(value)}`)
    }
  }

  return [
    style,
    integer(options.maxWidth),
    integer(options.blockIndent),
    integer(options.continuationIndent),
    trailingCommas,
    flag(options.removeUnusedImports),
    flag(options.preserveLambdaBreaks),
  ]
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/**
 * Builds the boot pair for the formatter.
 *
 * The module is ktrs's ktfmt port compiled to `wasm32-unknown-unknown`: it
 * imports nothing, so it is instantiated with an empty import object and no
 * shim of any kind. One instance is booted and reused.
 *
 * The instance does not leak: Rust frees what a format allocates, and linear
 * memory grows only to fit the largest source it has seen. The one thing that
 * ends an instance is a trap - a Rust panic aborts on this target, and input
 * nested deeply enough exhausts the engine's call stack - after which its
 * memory is in whatever state the trap left it. So the trap is reported as an
 * error, the instance is dropped, and the next call instantiates a fresh one
 * from the module the source has already compiled.
 *
 * Instantiation is always synchronous. The module is under 1 MB, far inside the
 * 8 MB a browser main thread allows `new WebAssembly.Instance`, so once the
 * bytes are compiled nothing in either environment needs to await.
 */
export const createKotlinFormatter = (source: ArtifactSource): KotlinFormatterBoot => {
  /** The live instance. Dropped after a trap, so that the next call replaces it. */
  let current: KotlinFormatter | undefined

  const instantiate = (module: WebAssembly.Module): KotlinFormatter => {
    const exports = new WebAssembly.Instance(module, {}).exports as unknown as KotlinFmtExports

    const formatter: KotlinFormatter = {
      format: (input, options) => {
        // Before touching the instance, so a bad option fails without costing it.
        const encoded = encodeOptions(options)
        const bytes = encoder.encode(String(input))

        let status: number
        try {
          const pointer = exports.kotlin_fmt_alloc(bytes.length)
          new Uint8Array(exports.memory.buffer, pointer, bytes.length).set(bytes)
          // The module takes ownership of the buffer and frees it.
          status = exports.kotlin_fmt_format(pointer, bytes.length, ...encoded)
        } catch (error) {
          // A trap leaves the instance in whatever state it stopped in, so it is
          // never used again. Dropping it here is what makes the next call
          // instantiate a fresh one.
          if (current === formatter) current = undefined
          throw new Error(
            error instanceof RangeError
              ? 'the formatter ran out of stack on this source - it is nested more deeply than it can follow'
              : 'the formatter crashed on this source - please report this',
            { cause: error },
          )
        }

        // Read before anything else runs: the result lives in the module's
        // memory only until the next format replaces it.
        const result = decoder.decode(
          new Uint8Array(exports.memory.buffer, exports.kotlin_fmt_result_ptr(), exports.kotlin_fmt_result_len()),
        )
        if (status !== OK) throw new Error(result)
        return result
      },
    }

    return formatter
  }

  const bootSync = (): KotlinFormatter | undefined => {
    if (current) return current

    // `compileSync` throws rather than answering `undefined` when the artifact
    // is missing under Node, and that is the error worth surfacing, so it is
    // left to propagate.
    const module = source.compileSync()
    if (module) current = instantiate(module)
    return current
  }

  const boot = async (): Promise<KotlinFormatter> => {
    // The synchronous path first, so that under Node `format` and `formatSync`
    // boot through exactly the same code.
    const ready = bootSync()
    if (ready) return ready

    const module = await source.compile()
    // Another call may have got there first while this one awaited, and that
    // instance stands.
    current ??= instantiate(module)
    return current
  }

  return { boot, bootSync }
}
