import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

/**
 * Resolves a sibling module that has to be handed to Node as a path rather than
 * imported - a worker thread's entry point, a child process's entry point.
 *
 * Those are spelled `<name>.js` when we are running from `dist`, which is what a
 * consumer gets, and `<name>.ts` when the tests run straight out of `src`. Same
 * file either way, and the runtime that loaded this one can load that one.
 */
export const siblingEntry = (name: string): string => {
  const compiled = path.join(here, `${name}.js`)
  return fs.existsSync(compiled) ? compiled : path.join(here, `${name}.ts`)
}
