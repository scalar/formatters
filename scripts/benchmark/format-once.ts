// Formats one file and exits, under plain Node.
//
// This is the wasm side of the cold-start comparison, and it is deliberately the
// dumbest possible program: import, format, done. Timed from the outside by the
// harness, it costs exactly what a `node format.js one-file.rb` costs a user who
// formats a single file and gets no chance to amortise anything - which is the
// shape the native CLIs on the other side of that comparison also have.

import fs from 'node:fs'

type FormatterModule = {
  format: (source: string, options?: Record<string, unknown>) => Promise<string>
}

const [entry, sourceFile, optionsJson] = process.argv.slice(2)
if (entry === undefined || sourceFile === undefined) {
  throw new Error('usage: format-once.ts <entry> <source-file> [options-json]')
}

const { format } = (await import(entry)) as FormatterModule
const formatted = await format(fs.readFileSync(sourceFile, 'utf8'), JSON.parse(optionsJson ?? '{}'))

// Written back rather than dropped, so this pays the same write the native CLIs
// pay when they format in place. It is a few microseconds, and leaving it out
// would be the sort of small unfairness that is hard to see later.
fs.writeFileSync(sourceFile, formatted)
