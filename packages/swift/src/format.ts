import { File } from '@bjorn3/browser_wasi_shim'

import { createBootModule } from './boot-module'
import type { ArtifactSource, FormatOptions, Formatters, SwiftFormatModule } from './types'

/** Status codes the Swift side returns. See build/swift_fmt/Sources/swift_fmt/main.swift. */
const STATUS_OK = 0

/**
 * Formats one source through an already-booted module.
 *
 * Every step here is synchronous, which is the whole reason `formatSync` can
 * exist: the only asynchronous thing this package ever does is get the wasm
 * compiled and instantiated, and by the time this runs that has happened.
 */
const formatThrough = (
  booted: SwiftFormatModule,
  recycle: () => SwiftFormatModule | undefined,
  source: string,
  options: FormatOptions,
): string => {
  const { run, workFiles, diagnostics } = booted

  const encoder = new TextEncoder()
  workFiles.set('input.swift', new File(encoder.encode(String(source))))
  workFiles.set('config.json', new File(encoder.encode(JSON.stringify(options))))
  workFiles.delete('output.swift')
  diagnostics.length = 0

  let status: number
  try {
    status = run()
  } catch (error) {
    // A trap leaves the Swift runtime mid-call, so this instance is finished -
    // every later call on it would inherit whatever state it died in. The most
    // likely cause is a stack overflow on pathologically nested source, which
    // is worth reporting as itself rather than as a bare RuntimeError.
    recycle()
    throw new Error(
      `swift-format crashed while formatting. This is usually deeply nested source exhausting the module's stack. ` +
        `(${error instanceof Error ? error.message : String(error)})`,
    )
  }

  if (status !== STATUS_OK) {
    throw new Error(diagnostics.length > 0 ? diagnostics.join('\n') : `swift-format failed with status ${status}`)
  }

  const output = workFiles.get('output.swift') as File | undefined
  if (!output) throw new Error('swift-format reported success but produced no output')

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
   * Formats Swift source with swift-format compiled to WebAssembly.
   *
   * The first call decompresses, compiles and boots the module (~0.5s); later
   * calls reuse it and take ~30ms.
   *
   * Options are swift-format's own `Configuration` keys, and anything omitted
   * keeps swift-format's default. Note that a `.swift-format` file on disk is
   * *not* consulted - the module has no filesystem to search - so a project's
   * configuration has to be read and passed in by the caller.
   */
  const format = async (source: string, options: FormatOptions = {}): Promise<string> =>
    formatThrough(await boot(), recycle, source, options)

  /**
   * Formats Swift source without awaiting, for callers that cannot.
   *
   * Same swift-format, same options, same bytes out as `format` - the only
   * difference is that this one refuses to wait. Booting is asynchronous no
   * matter what (the wasm has to be fetched or read, and compiled), so this
   * throws until that has happened. Call `init` once, then this as often as you
   * like.
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
