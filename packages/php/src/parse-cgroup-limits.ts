/** The cgroup files that describe a CPU and memory budget, as read from disk. */
export type CgroupFiles = {
  /** cgroup v2 `cpu.max`: `"<quota> <period>"`, or `"max <period>"` when unlimited. */
  cpuMax?: string | undefined
  /** cgroup v1 `cpu.cfs_quota_us`. Negative means unlimited. */
  cfsQuota?: string | undefined
  /** cgroup v1 `cpu.cfs_period_us`, the window `cfsQuota` is measured over. */
  cfsPeriod?: string | undefined
  /** cgroup v2 `memory.max`: bytes, or the literal `"max"`. */
  memoryMax?: string | undefined
  /** cgroup v1 `memory.limit_in_bytes`: bytes, or a value near 2^63 when unlimited. */
  memoryLimitInBytes?: string | undefined
}

export type CgroupLimits = {
  /** The CPU quota as a core count, or `undefined` when there is no quota. */
  cpus: number | undefined
  /** The memory limit in bytes, or `undefined` when there is no limit. */
  memoryBytes: number | undefined
}

/**
 * Turns the raw cgroup files into a CPU and memory budget.
 *
 * Kept separate from reading them so the awkward part is testable without a
 * container: two cgroup versions, three spellings of "no limit" - the word `max`,
 * a negative quota, and a number so close to 2^63 that it is a sentinel rather
 * than a limit - and a quota that is a *rate* rather than a count of cores.
 *
 * A fractional quota rounds up. Half a core is still enough to run one PHP
 * instance; it just runs it slowly, and rounding down to zero would be a lie.
 */
export const parseCgroupLimits = (files: CgroupFiles): CgroupLimits => ({
  cpus: parseCpus(files),
  memoryBytes: parseMemory(files),
})

const parseCpus = ({ cpuMax, cfsQuota, cfsPeriod }: CgroupFiles): number | undefined => {
  if (cpuMax) {
    const [quota, period] = cpuMax.trim().split(/\s+/)
    if (quota === undefined || quota === 'max') return undefined

    return cores(Number(quota), Number(period))
  }

  if (cfsQuota === undefined) return undefined

  return cores(Number(cfsQuota), Number(cfsPeriod))
}

const cores = (quota: number, period: number): number | undefined => {
  if (!Number.isFinite(quota) || quota <= 0) return undefined
  if (!Number.isFinite(period) || period <= 0) return undefined

  return Math.max(1, Math.ceil(quota / period))
}

/**
 * cgroup v1 spells an absent memory limit as a number rather than a word - the
 * page-aligned maximum, `0x7ffffffffffff000` - so anything petabyte-scale is
 * treated as no limit at all.
 */
const UNLIMITED_MEMORY_FLOOR = 2 ** 50

const parseMemory = ({ memoryMax, memoryLimitInBytes }: CgroupFiles): number | undefined => {
  const raw = memoryMax ?? memoryLimitInBytes
  if (raw === undefined || raw.trim() === 'max') return undefined

  const bytes = Number(raw.trim())
  if (!Number.isFinite(bytes) || bytes <= 0 || bytes >= UNLIMITED_MEMORY_FLOOR) return undefined

  return bytes
}
