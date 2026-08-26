// Measures one package, in a process of its own, under plain Node.
//
// Under Node rather than bun because Node is what a consumer runs, and the
// numbers are meant to be the ones they would see. It loads `dist`, the same
// build npm ships, for the same reason.
//
// In a process of its own because these packages are expensive to share one.
// Each caches its compiled module and a booted instance for the life of the
// process, and once several language runtimes are resident together they slow
// each other down badly - scripts/test-packages.ts has the measurements. A
// benchmark that ran them all in one process would be reporting that
// interference rather than the formatter.
//
// The result goes to a file, not to stdout: a package that writes a stray line
// to stdout would otherwise corrupt the numbers it is reporting.

import fs from 'node:fs'

import { repeat, timed } from './measure.ts'

/** What the harness asks for. Everything is absolute, so cwd does not matter. */
type Request = {
  entry: string
  sourceFile: string
  options: Record<string, unknown>
  initOptions: Record<string, unknown>
  runs: number
  warmup: number
  /** How many copies to hand `format` at once, or 0 for a package whose `format` takes only a string. */
  group: number
  resultFile: string
}

/** A formatter package's Node entry, as far as this file cares. */
type FormatterModule = {
  format: ((source: string, options?: Record<string, unknown>) => Promise<string>) &
    ((sources: readonly string[], options?: Record<string, unknown>) => Promise<unknown[]>)
  init?: (options?: Record<string, unknown>) => Promise<unknown>
}

const requestFile = process.argv[2]
if (requestFile === undefined) throw new Error('usage: measure-package.ts <request.json>')

const request = JSON.parse(fs.readFileSync(requestFile, 'utf8')) as Request
const source = fs.readFileSync(request.sourceFile, 'utf8')

let loaded: FormatterModule | undefined
const importMs = await timed(async () => {
  loaded = (await import(request.entry)) as FormatterModule
})
if (loaded === undefined) throw new Error(`${request.entry} did not load`)
const { format, init } = loaded

// `init` is how six of the seven packages let a caller pay for booting up front.
// PHP has no such export - it boots inside the first `format` - so its boot cost
// lands in `firstFormatMs` instead, which is why that number is reported too.
const bootMs = init ? await timed(async () => void (await init(request.initOptions))) : undefined

// Kept, rather than discarded, so the harness can assert that something was
// actually formatted - a package that returned its input unchanged would
// otherwise look like a very fast one.
let formatted = ''
const firstFormatMs = await timed(async () => {
  formatted = await format(source, request.options)
})

// One warmed-up format is what a caller gets for every file after the first, so
// that is the number the native side's per-file cost is compared against.
const steady = await repeat(request.runs, request.warmup, async () => {
  await format(source, request.options)
})

// A group in one call, where the package offers one. Measured after the steady
// state so it is comparing a warm instance against a warm instance, and divided
// by the group size because that is the number a caller feels per file.
const groupPerFileMs =
  request.group > 1
    ? (await timed(async () => {
        await format(
          Array.from({ length: request.group }, () => source),
          request.options,
        )
      })) / request.group
    : undefined

fs.writeFileSync(
  request.resultFile,
  JSON.stringify({ importMs, bootMs, firstFormatMs, steady, groupPerFileMs, formattedBytes: formatted.length }),
)
