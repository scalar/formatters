// Runs the test suite one package at a time, each in its own `bun test` process.
//
// `bun test` at the repo root puts every package's tests in a single process, and
// that process is where this repo's tests are unusually expensive to share. Each
// package caches its compiled wasm module and a booted instance in a module-level
// binding for the life of the process, by design - booting is the slow part, and
// tests that re-boot per case would cost far more than they do now. Nothing ever
// drops them, so a root `bun test` ends holding seven language runtimes at once.
//
// That turned out to have a cliff in it. The Ruby VM grows its linear memory by
// ~120MB per format and only a recycle reclaims it (see packages/ruby/src/format.ts),
// and once enough other wasm instances are resident alongside it, those growths get
// roughly two orders of magnitude slower: packages/ruby/test/vm-recycle.test.ts runs
// in 15s on its own and did not finish a quarter of its passes in eight minutes
// sharing a process with the other six packages. Measured on the same checkout, the
// whole suite is 57s split by package against 545s shared - and the shared run fails,
// because vm-recycle's wall-clock budget fires.
//
// The cliff is what made this present as a flake rather than a bug. No single package
// causes it: five packages plus Ruby is fine, six is not, and dropping either php or
// swift from the six puts it back under. So which side of the edge a run lands on
// moves with whatever the other packages happen to allocate that day, and a change to
// one package could - and did - break a test in another.
//
// Splitting by package removes the interaction rather than tuning against it. It costs
// one bun start per package (~30ms) and no extra wasm compilation, since each artifact
// was already compiled exactly once per process.

import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import path from 'node:path'

const packagesDir = path.join(import.meta.dir, '..', 'packages')

/** Package directory names, or the subset named on the command line. */
const requested = process.argv.slice(2)
const packages = requested.length > 0 ? requested : readdirSync(packagesDir).sort()

const failed: string[] = []

for (const name of packages) {
  console.log(`\n=== ${name} ===`)

  // `bun test <dir>` rather than a cwd change: the root tsconfig and lockfile stay in
  // scope, so a package's tests run exactly as they did before this script existed.
  const { status } = spawnSync('bun', ['test', '--timeout', '30000', path.join('packages', name)], {
    cwd: path.join(import.meta.dir, '..'),
    stdio: 'inherit',
  })

  if (status !== 0) failed.push(name)
}

// Every package runs even after one fails. The whole suite is under a minute now, and
// one red package hiding the state of the other six is the more expensive outcome.
if (failed.length > 0) {
  console.error(`\n${failed.length} package(s) failed: ${failed.join(', ')}`)
  process.exit(1)
}

console.log(`\nAll ${packages.length} packages passed.`)
