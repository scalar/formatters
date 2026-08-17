import { File } from '@bjorn3/browser_wasi_shim'

import type { BootVm, FormatFunction, FormatOptions } from './types'

/** syntax_tree's own default line width. */
const DEFAULT_PRINT_WIDTH = 80

/**
 * Recycle the VM once its linear memory passes this. The hard wall is the
 * wasm32 signed-pointer boundary at 2GB; this leaves room for one more format
 * to finish - a single large file can add ~75MB on its own.
 *
 * Held well below that wall rather than just under it, because the wall is not
 * the only thing that matters: a recycle cannot hand back the old VM's linear
 * memory synchronously, so for a moment the process holds the outgoing buffer
 * and the incoming one at once. At the 1.1GB this used to sit at, that pair
 * peaked at ~1.5GB resident and made the whole suite thrash on a 16GB CI
 * runner. 400MB keeps the peak near 1GB, and the extra recycles it costs are
 * ~250ms each against the ~113MB every 37KB of input adds.
 */
const MEMORY_LIMIT_BYTES = 400_000_000

/**
 * Builds `format` over one booted VM.
 *
 * The entry points call this: `index.ts` with the VM built on the artifact read
 * from disk, `index.browser.ts` with the one built on the artifact fetched over
 * HTTP. Everything below this line is identical either way, which is the point
 * - the environment difference is confined to how the bytes arrive.
 */
export const createFormat = ({ boot, recycle }: BootVm): FormatFunction => {
  /**
   * Formats Ruby source with syntax_tree running on CRuby compiled to
   * WebAssembly. The first call boots the VM (~1.1s); later calls reuse it and
   * take about 4ms.
   */
  return async (source: string, options: FormatOptions = {}): Promise<string> => {
    // Formatting leaks: the VM's linear memory grows by roughly 74MB per 23KB of
    // input and is never released. It is not Ruby-level garbage - the object heap
    // stays flat at ~65k live slots and GC.start does not help - so nothing inside
    // the VM can reclaim it. Left alone the VM reaches the wasm32 2GB boundary
    // after ~680KB of cumulative input, a guest pointer read as a signed i32 goes
    // negative, and the glue throws `RangeError: Start offset -… is outside the
    // bounds of the buffer`. Dropping the VM is the only lever we have, so this
    // trades a rare pause for not crashing.
    const booted = await boot()
    const { vm, workFiles } = booted.memory.buffer.byteLength > MEMORY_LIMIT_BYTES ? await recycle() : booted

    // printWidth ends up interpolated into Ruby source, so it is coerced and
    // checked rather than trusted. TypeScript stops nothing here: the types are
    // advisory to a JavaScript caller, and `{ printWidth: '80; system("…")' }` is
    // perfectly expressible in plain JS.
    const printWidth = Number(options.printWidth ?? DEFAULT_PRINT_WIDTH)
    if (!Number.isInteger(printWidth) || printWidth < 1) {
      throw new TypeError(`printWidth must be a positive integer, received ${String(options.printWidth)}`)
    }

    // The source is written straight into the guest filesystem rather than
    // interpolated into Ruby code. Embedding it in a Ruby string literal would
    // be unsafe: Ruby interpolates #{...} inside double quotes, and JSON escaping
    // does not escape '#', so any Ruby snippet containing #{} would be evaluated.
    workFiles.set('input.rb', new File(new TextEncoder().encode(source)))

    // The result is parsed before it is returned. A formatter that emits source
    // its own language cannot read is the one failure that has to be loud, and
    // syntax_tree 6.3.0 does exactly that on some `case/in` patterns - see
    // stree-patch.ts, which fixes the shapes we know about. This catches the ones
    // we do not: Ripper is already loaded for syntax_tree's own parsing, so the
    // check costs ~2.7ms against a ~28ms format and turns a silently corrupt file
    // into an exception raised before anything is written.
    return vm
      .eval(
        `out = SyntaxTree.format(File.read("/work/input.rb"), ${printWidth})
       raise "syntax_tree produced source that Ruby cannot parse, so it was discarded rather than returned - please report this" if Ripper.sexp(out).nil?
       out`,
      )
      .toString()
  }
}
