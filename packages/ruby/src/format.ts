import { File } from '@bjorn3/browser_wasi_shim'

import { WORK_DIR } from './boot-vm'
import { buildRuboCopConfig } from './rubocop'
import type { BootVm, FormatOptions, Formatters, RbcopBoot, RbcopCorrector, RubyFormatterVm } from './types'

/** syntax_tree's own default line width. */
const DEFAULT_PRINT_WIDTH = 80

/**
 * Whether the RuboCop pass runs when the caller says nothing.
 *
 * On, because syntax_tree alone leaves Layout offenses in about 30% of real
 * files and output a linter rejects is not finished output. `rubocop: false`
 * turns the pass off, and with it the loading of the rbcop module.
 */
const DEFAULT_RUBOCOP = true

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
 * runner. 400MB keeps the peak near 1GB. A pre-initialized VM starts ~27MB
 * under that ceiling, which real input crosses about every 140KB - measured at
 * 17 recycles over a 2.4MB corpus - and each of those costs ~0.5s.
 */
const MEMORY_LIMIT_BYTES = 400_000_000

/**
 * The ceiling `formatSync` refuses at, higher than the one `format` recycles at.
 *
 * `format` recycles at 400MB because a recycle briefly holds the outgoing VM's
 * linear memory and the incoming one at once, and 400MB keeps that pair near
 * 1GB. `formatSync` never pays that: it cannot recycle at all, so it holds one
 * VM and can be let much closer to the wasm32 signed-pointer wall at 2GB before
 * it has to stop. The gap between the two is deliberate headroom - it is how
 * many more samples a synchronous caller gets before it has to await.
 */
const SYNC_MEMORY_LIMIT_BYTES = 1_200_000_000

/** Where the source being formatted lives in the guest filesystem. */
const INPUT_PATH = `${WORK_DIR}/input.rb`

/**
 * Reprints one source with syntax_tree, in an already-booted VM.
 *
 * The source is written into the guest filesystem rather than interpolated
 * into Ruby code. Embedding it in a Ruby string literal would be unsafe: Ruby
 * interpolates #{...} inside double quotes, and JSON escaping does not escape
 * '#', so any Ruby snippet containing #{} would be evaluated. `printWidth` is
 * interpolated, so the caller must have checked it is a positive integer.
 *
 * The result is parsed before it is returned. A formatter that emits source its
 * own language cannot read is the one failure that has to be loud, and
 * syntax_tree 6.3.0 does exactly that on some `case/in` patterns - see
 * stree-patch.ts, which fixes the shapes we know about. This catches the ones
 * we do not: Ripper is already loaded for syntax_tree's own parsing, so the
 * check costs ~2.7ms against a ~24ms format and turns a silently corrupt file
 * into an exception raised before anything is written.
 *
 * Exported for `build/ruby_fmt/preinit.ts`, which verifies a fresh snapshot
 * through exactly this pass rather than a copy of it.
 */
export const reprint = (booted: RubyFormatterVm, source: string, printWidth: number): string => {
  booted.workFiles.set('input.rb', new File(new TextEncoder().encode(source)))

  return booted.vm
    .eval(
      `out = SyntaxTree.format(File.read(${JSON.stringify(INPUT_PATH)}), ${printWidth})
       raise "the formatter produced source that Ruby cannot parse, so it was discarded rather than returned - please report this" if Ripper.sexp(out).nil?
       out`,
    )
    .toString()
}

/**
 * Reads `printWidth` off the options, checked.
 *
 * It ends up interpolated into Ruby source, so it is coerced and checked
 * rather than trusted. TypeScript stops nothing here: the types are advisory to
 * a JavaScript caller, and `{ printWidth: '80; system("…")' }` is perfectly
 * expressible in plain JS.
 */
const printWidthOf = (options: FormatOptions): number => {
  const printWidth = Number(options.printWidth ?? DEFAULT_PRINT_WIDTH)
  if (!Number.isInteger(printWidth) || printWidth < 1) {
    throw new TypeError(`printWidth must be a positive integer, received ${String(options.printWidth)}`)
  }
  return printWidth
}

/**
 * Formats one source through already-booted modules.
 *
 * Every step here is synchronous, which is the whole reason `formatSync` can
 * exist: the only asynchronous things this package does per format are booting
 * and deciding whether to recycle first.
 *
 * RuboCop runs on syntax_tree's output, never on the raw input, and the order
 * is not arbitrary: the two disagree about multiline indentation, so whichever
 * runs last decides. syntax_tree reprints the whole file and RuboCop only
 * corrects offenses in what it is given, so syntax_tree first and RuboCop
 * second is the pairing that both reprints canonically *and* comes out clean
 * under `rubocop --only Layout`. The other order does neither.
 */
const formatThrough = (
  booted: RubyFormatterVm,
  rbcop: RbcopCorrector | undefined,
  source: string,
  options: FormatOptions,
): string => {
  const reprinted = reprint(booted, source, printWidthOf(options))
  return rbcop ? rbcop.correct(reprinted, buildRuboCopConfig(options.rubocopConfig)) : reprinted
}

/**
 * Builds the package's public functions over one Ruby VM and one rbcop.
 *
 * The entry points call this: `index.ts` with the modules read from disk,
 * `index.browser.ts` with the ones fetched over HTTP. Everything below this
 * line is identical either way, which is the point - the environment
 * difference is confined to how the bytes arrive.
 */
export const createFormat = (ruby: BootVm, rbcop: RbcopBoot): Formatters => {
  /**
   * Formats Ruby source with syntax_tree, running on CRuby compiled to
   * WebAssembly, and then RuboCop's Layout pass, running as rbcop. The first
   * call compiles and instantiates what it needs; later calls reuse both.
   */
  const format = async (source: string, options: FormatOptions = {}): Promise<string> => {
    // Formatting leaks: the VM's linear memory grows with every format and is
    // never released. It is not Ruby-level garbage - the object heap stays flat
    // and GC.start does not help - so nothing inside the VM can reclaim it. Left
    // alone the VM reaches the wasm32 2GB boundary, a guest pointer read as a
    // signed i32 goes negative, and the glue throws `RangeError: Start offset -…
    // is outside the bounds of the buffer`. Dropping the VM is the only lever we
    // have, so this trades a rare pause for not crashing.
    //
    // rbcop is booted only when the pass will run, so that `rubocop: false`
    // never pays for loading it - in a browser, that is a download saved.
    const [booted, corrector] = await Promise.all([
      ruby.boot(),
      (options.rubocop ?? DEFAULT_RUBOCOP) ? rbcop.boot() : undefined,
    ])
    const vm = booted.memory.buffer.byteLength > MEMORY_LIMIT_BYTES ? await ruby.recycle() : booted

    return formatThrough(vm, corrector, source, options)
  }

  /**
   * Formats Ruby source without awaiting, for callers that cannot.
   *
   * Same tools, same options, same bytes out as `format`. Three things it
   * cannot do, all following from the same fact - instantiating a module is
   * asynchronous, because `WebAssembly.instantiate` is:
   *
   * 1. It throws until `init` has resolved, like every `formatSync` here.
   * 2. It throws once the VM's memory passes {@link SYNC_MEMORY_LIMIT_BYTES},
   *    because clearing that needs a recycle it cannot perform.
   * 3. It throws after the RuboCop pass has crashed, because replacing the
   *    rbcop instance a crash leaves behind is an instantiation too.
   *
   * This is the one package in the repo where a long synchronous run has to come
   * up for air: `await init()` again at that point and the VM is replaced. The
   * limit is set high - well above the ceiling `format` recycles at - so that a
   * caller formatting ordinary snippets gets a long run between pauses, and the
   * error says exactly what to do rather than letting the VM walk into the 2GB
   * wall and throw a `RangeError` from inside the glue.
   */
  const formatSync = (source: string, options: FormatOptions = {}): string => {
    const booted = ruby.peek()
    const corrector = rbcop.peek()
    const wantsRubocop = options.rubocop ?? DEFAULT_RUBOCOP

    if (!booted || (wantsRubocop && !corrector)) {
      throw new Error(
        'formatSync was called before the formatter finished booting. Await init() once before the first ' +
          'formatSync, or use the async format() instead, which waits on its own.',
      )
    }

    if (booted.memory.buffer.byteLength > SYNC_MEMORY_LIMIT_BYTES) {
      throw new Error(
        'the Ruby VM has grown past what a synchronous caller can clear. Formatting leaks linear memory ' +
          'and only a recycle reclaims it, which is asynchronous - await init() once to replace the VM, ' +
          'then carry on with formatSync.',
      )
    }

    return formatThrough(booted, wantsRubocop ? corrector : undefined, source, options)
  }

  /**
   * Boots both modules, so that `formatSync` can be called afterwards.
   *
   * Optional for `format`, which boots on demand, and required before the first
   * `formatSync` - and again whenever `formatSync` reports that the VM needs
   * replacing or that the RuboCop pass crashed.
   */
  const init = async (): Promise<void> => {
    const [booted] = await Promise.all([ruby.boot(), rbcop.boot()])
    if (booted.memory.buffer.byteLength > MEMORY_LIMIT_BYTES) await ruby.recycle()
  }

  return { format, formatSync, init }
}
