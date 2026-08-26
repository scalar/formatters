import { createBootVm } from './boot-vm'
import { compileArtifact } from './compile-artifact'
import { readSnapshot } from './read-snapshot'
import type { BootVm } from './types'

/**
 * The VM the Node build formats through.
 *
 * It lives in its own module because two things need the *same* one: `index.ts`,
 * which wraps it in `format`, and `test/vm-recycle.test.ts`, which watches its
 * linear memory to prove recycling still happens. Building a second `createBootVm`
 * for the test would boot a second VM and measure nothing.
 */
export const nodeVm: BootVm = createBootVm(compileArtifact, readSnapshot)
