import { parseCgroupLimits } from './parse-cgroup-limits'
import { describe, expect, it } from 'bun:test'

describe('parse-cgroup-limits', () => {
  it('reads a cgroup v2 CPU quota as a core count', () => {
    // `docker run --cpus=2` on the usual 100ms period.
    expect(parseCgroupLimits({ cpuMax: '200000 100000\n' }).cpus).toBe(2)
  })

  // Half a core still runs one PHP instance, just slowly, so a fractional quota
  // rounds up rather than down to an impossible zero.
  it('rounds a fractional CPU quota up to one core', () => {
    expect(parseCgroupLimits({ cpuMax: '50000 100000\n' }).cpus).toBe(1)
    expect(parseCgroupLimits({ cpuMax: '150000 100000\n' }).cpus).toBe(2)
  })

  it('treats an unlimited cgroup v2 quota as no CPU limit', () => {
    expect(parseCgroupLimits({ cpuMax: 'max 100000\n' }).cpus).toBeUndefined()
  })

  it('reads a cgroup v1 CPU quota from its two files', () => {
    expect(parseCgroupLimits({ cfsQuota: '400000\n', cfsPeriod: '100000\n' }).cpus).toBe(4)
  })

  // v1 spells "no quota" as a negative number rather than a word.
  it('treats a negative cgroup v1 quota as no CPU limit', () => {
    expect(parseCgroupLimits({ cfsQuota: '-1\n', cfsPeriod: '100000\n' }).cpus).toBeUndefined()
  })

  it('reports no CPU limit when neither cgroup version is mounted', () => {
    expect(parseCgroupLimits({}).cpus).toBeUndefined()
  })

  it('reads a cgroup v2 memory limit in bytes', () => {
    expect(parseCgroupLimits({ memoryMax: '1073741824\n' }).memoryBytes).toBe(1073741824)
  })

  it('treats an unlimited cgroup v2 memory limit as no limit', () => {
    expect(parseCgroupLimits({ memoryMax: 'max\n' }).memoryBytes).toBeUndefined()
  })

  // v1 has no word for it: an unconstrained cgroup reports the page-aligned
  // maximum, which would otherwise be read as a nine-exabyte budget.
  it('treats the cgroup v1 unlimited sentinel as no memory limit', () => {
    expect(parseCgroupLimits({ memoryLimitInBytes: '9223372036854771712\n' }).memoryBytes).toBeUndefined()
  })

  it('reads a cgroup v1 memory limit when v2 is absent', () => {
    expect(parseCgroupLimits({ memoryLimitInBytes: '536870912\n' }).memoryBytes).toBe(536870912)
  })

  it('prefers the cgroup v2 memory limit when both are present', () => {
    const limits = parseCgroupLimits({ memoryMax: '1073741824', memoryLimitInBytes: '536870912' })

    expect(limits.memoryBytes).toBe(1073741824)
  })

  it('ignores files it cannot make sense of', () => {
    expect(parseCgroupLimits({ cpuMax: 'nonsense', memoryMax: 'nonsense' })).toEqual({
      cpus: undefined,
      memoryBytes: undefined,
    })
  })
})
