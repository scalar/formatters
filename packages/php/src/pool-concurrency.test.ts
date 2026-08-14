import { poolConcurrency } from './pool-concurrency'
import { describe, expect, it } from 'bun:test'

describe('pool-concurrency', () => {
  // The whole point of the default is that it is safe to leave alone, so what it
  // must never do matters more than the exact number it picks on this machine.
  it('stays within one instance per file and the four-instance cap', () => {
    for (const fileCount of [1, 2, 7, 8, 16, 33, 200, 5000]) {
      const chosen = poolConcurrency(fileCount)

      expect(chosen).toBeGreaterThanOrEqual(1)
      expect(chosen).toBeLessThanOrEqual(4)
      expect(chosen).toBeLessThanOrEqual(fileCount)
    }
  })

  // A child process costs about 400ms to boot PHP. Below eight files a shard
  // does not repay that, so a small batch belongs on the instance we already have.
  it('keeps a batch too small to repay a child process in one instance', () => {
    expect(poolConcurrency(1)).toBe(1)
    expect(poolConcurrency(7)).toBe(1)
  })

  it('never grows faster than one instance per eight files', () => {
    expect(poolConcurrency(16)).toBeLessThanOrEqual(2)
    expect(poolConcurrency(24)).toBeLessThanOrEqual(3)
  })

  // A caller who names a number knows their container better than the heuristic
  // does, so it is taken as given rather than clamped down to it.
  it('honours a requested concurrency', () => {
    expect(poolConcurrency(100, 1)).toBe(1)
    expect(poolConcurrency(100, 7)).toBe(7)
    expect(poolConcurrency(100, 64)).toBe(64)
  })

  it('never boots an instance with no file for it', () => {
    expect(poolConcurrency(3, 8)).toBe(3)
    expect(poolConcurrency(1, 4)).toBe(1)
  })

  it('rejects a concurrency that is not a positive integer', () => {
    expect(() => poolConcurrency(10, 0)).toThrow(TypeError)
    expect(() => poolConcurrency(10, -2)).toThrow(TypeError)
    expect(() => poolConcurrency(10, 1.5)).toThrow(TypeError)
    expect(() => poolConcurrency(10, Number.NaN)).toThrow(TypeError)
  })
})
