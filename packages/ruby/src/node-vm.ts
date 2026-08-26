import { createBootVm } from './boot-vm'
import { compileArtifact } from './compile-artifact'
import type { BootVm } from './types'

/**
 * The VM the Node build formats through.
 *
 * It lives in its own module because several things need the *same* one:
 * `index.ts`, which wraps it in `format`; `test/vm-recycle.test.ts`, which
 * watches its linear memory to prove recycling still happens; and
 * `scripts/ruby-bench-measure.ts`, which counts recycles by watching the record
 * this hands back. Building a second `createBootVm` for any of them would boot a
 * second VM and measure nothing.
 */
export const nodeVm: BootVm = createBootVm(compileArtifact)
