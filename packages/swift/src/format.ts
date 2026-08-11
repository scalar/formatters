import { File } from '@bjorn3/browser_wasi_shim'

import { bootModule, recycleModule } from './boot-module'
import type { FormatOptions } from './types'

/** Status codes the Swift side returns. See build/swift_fmt/Sources/swift_fmt/main.swift. */
const STATUS_OK = 0

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
export const format = async (source: string, options: FormatOptions = {}): Promise<string> => {
  const { run, workFiles, diagnostics } = await bootModule()

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
    recycleModule()
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
