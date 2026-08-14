import fs from 'node:fs'
import os from 'node:os'

import { parseCgroupLimits } from './parse-cgroup-limits'

/**
 * What this process can actually spend - CPUs and memory - as opposed to what
 * the machine happens to have.
 *
 * The distinction matters because batch formatting runs several PHP instances at
 * once, and the obvious sources are both wrong inside a container.
 * `os.availableParallelism()` reports the host's CPUs: it follows the CPU
 * affinity mask, so `docker run --cpuset-cpus` shows up in it, but a CPU *quota*
 * - `--cpus=2`, a Kubernetes `limits.cpu` - does not, because a quota throttles a
 * process rather than confining it to fewer cores. `os.totalmem()` reports the
 * host's RAM for the same reason. Read the cgroup as well and a container given
 * one CPU and 1GB stops helping itself to a batch sized for thirty-two and 128GB.
 */

type HostLimits = {
  /** CPUs this process can use at once, cgroup quota included. */
  cpus: number
  /** Memory this process may spend, from the cgroup limit or the host's RAM. */
  memoryBytes: number
}

/** Reads a cgroup file, returning `undefined` for the many ways that can fail. */
const read = (path: string): string | undefined => {
  try {
    return fs.readFileSync(path, 'utf8')
  } catch {
    return undefined
  }
}

export const hostLimits = (): HostLimits => {
  const limits = parseCgroupLimits({
    cpuMax: read('/sys/fs/cgroup/cpu.max'),
    cfsQuota: read('/sys/fs/cgroup/cpu/cpu.cfs_quota_us'),
    cfsPeriod: read('/sys/fs/cgroup/cpu/cpu.cfs_period_us'),
    memoryMax: read('/sys/fs/cgroup/memory.max'),
    memoryLimitInBytes: read('/sys/fs/cgroup/memory/memory.limit_in_bytes'),
  })

  // `availableParallelism` arrived in Node 18.14; `cpus()` covers anything older.
  const hostCpus = os.availableParallelism?.() ?? os.cpus().length

  return {
    cpus: Math.max(1, limits.cpus === undefined ? hostCpus : Math.min(hostCpus, limits.cpus)),
    memoryBytes: limits.memoryBytes ?? os.totalmem(),
  }
}
