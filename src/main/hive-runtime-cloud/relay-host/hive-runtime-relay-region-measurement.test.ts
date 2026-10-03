import { expect, it, vi } from 'vitest'
import type { HiveRuntimeRelayRegionMeasurementWindow } from './hive-runtime-relay-heartbeat-types'
import { measureHiveRuntimeRelayRegions } from './hive-runtime-relay-region-measurement'

function window(candidateCount = 8): HiveRuntimeRelayRegionMeasurementWindow {
  return {
    policyVersion: 1,
    generation: 7,
    expiresAt: Date.now() + 60_000,
    assignmentId: '10000000-0000-4000-8000-000000000001',
    assignmentEpoch: 3,
    incumbentRegion: 'region-0',
    candidates: Array.from({ length: candidateCount }, (_, index) => ({
      region: `region-${index}`,
      probeUrl: `https://relay-${index}.example/`
    }))
  }
}

it('measures the complete Cloud window with bounded concurrency', async () => {
  let active = 0
  let maximumActive = 0
  let clock = 0
  const cancel = vi.fn(async () => {})
  const result = await measureHiveRuntimeRelayRegions(window(), {
    now: () => Date.now() + clock++ * 5,
    fetch: vi.fn(async () => {
      active++
      maximumActive = Math.max(maximumActive, active)
      await new Promise<void>((resolve) => setImmediate(resolve))
      active--
      return { body: new ReadableStream({ cancel }) }
    })
  })
  expect(maximumActive).toBe(3)
  expect(result.outcome).toBe('CONCLUSIVE')
  expect(result.measurements).toHaveLength(8)
  expect(cancel).toHaveBeenCalledTimes(8)
})

it('reports a bounded inconclusive result instead of partial measurements', async () => {
  const result = await measureHiveRuntimeRelayRegions(window(2), {
    fetch: vi.fn(async (url) => {
      if (url.includes('relay-1')) {
        throw new Error('unreachable')
      }
      return { body: null }
    })
  })
  expect(result).toMatchObject({
    outcome: 'INCONCLUSIVE',
    measurements: [],
    failure: 'NETWORK_ERROR'
  })
})
