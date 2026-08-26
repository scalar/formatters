// Measures what a consumer actually waits for, one package at a time.
//
// There are two numbers and they trade against each other, so reporting only one
// hides the cost of improving it. `boot` is the one-time price of getting the
// language runtime ready - decompressing the artifact, compiling the module,
// instantiating it, and loading whatever the formatter needs on top. `format` is
// the steady-state price per file once that is paid. A change that precompiles
// more into the artifact moves work from the second into the first; a change that
// defers loading moves it the other way. Only both together say whether a
// formatting run got faster.
//
// Every measurement runs in a fresh process, because every package caches its
// compiled module and its booted instance in a module-level binding for the life
// of the process. A second `boot` in the same process would measure the cache.
//
// Usage:
//   bun run bench                 every package
//   bun run bench ruby csharp     just those
//   bun run bench --json          machine-readable, for comparing two revisions
//   bun run bench ruby -- --no-rubocop   pass options through to the package

import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import path from 'node:path'

import { corpusFor } from './bench/corpus'
import { renderTable } from './bench/render-table'
import type { BenchResult } from './bench/types'

const root = path.join(import.meta.dir, '..')

/** Splits `bench ruby -- --no-rubocop` into the package list and the pass-through tail. */
const argv = process.argv.slice(2)
const separator = argv.indexOf('--')
const head = separator === -1 ? argv : argv.slice(0, separator)
const passthrough = separator === -1 ? [] : argv.slice(separator + 1)

const json = head.includes('--json')
const named = head.filter((arg) => !arg.startsWith('--'))
const packages = named.length > 0 ? named : readdirSync(path.join(root, 'packages')).sort()

/**
 * Runs one package's benchmark in its own process and reads the result back.
 *
 * The child prints one JSON line on stdout and everything else on stderr, so a
 * package whose runtime writes to stdout on boot - the .NET one does - cannot
 * corrupt the reading.
 */
const benchOne = (name: string): BenchResult | undefined => {
  const worker = path.join(import.meta.dir, 'bench', 'worker.ts')
  const { stdout, status, stderr } = spawnSync('bun', [worker, name, ...passthrough], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })

  if (status !== 0) {
    console.error(`${name}: benchmark failed\n${stderr}`)
    return undefined
  }

  const line = stdout.trim().split('\n').at(-1)
  return line ? (JSON.parse(line) as BenchResult) : undefined
}

const results: BenchResult[] = []

for (const name of packages) {
  const corpus = corpusFor(name)
  if (corpus.length === 0) {
    if (!json) console.error(`${name}: no corpus, skipped`)
    continue
  }

  const result = benchOne(name)
  if (result) results.push(result)
}

if (json) {
  console.log(JSON.stringify(results, null, 2))
} else {
  console.log(renderTable(results))
}
