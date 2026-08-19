// Formats one file and then yields, so the parent can read what the process
// wrote to stderr while doing it. Spawned by quiet.test.ts; see that file for
// why this has to be a separate process.
//
// Stdout carries the verdict, so an empty stderr can never be mistaken for a
// probe that failed before it formatted anything.

import { format, init } from '../src/index'

const EXPECTED = 'class A {}\n'

await init()
const formatted = await format('class  A  {  }\n', { style: 'kotlinlang' })

if (formatted !== EXPECTED) {
  console.log(`formatted unexpectedly: ${JSON.stringify(formatted)}`)
  process.exit(1)
}

// The noise this guards against was scheduled with setTimeout and landed on the
// turns *after* the first format resolved, not during it - so a probe that
// exited here would have passed while the module was still about to print.
// Yielding twice puts those turns inside the window the parent measures.
await new Promise((resolve) => setTimeout(resolve, 50))
await new Promise((resolve) => setTimeout(resolve, 50))

console.log('formatted')
