import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { claimedState, fixture } from './hive-runtime-cloud-presence-test-fixture'
import type { HiveRuntimeCloudPresenceService } from './hive-runtime-cloud-presence-service'
import { HiveRuntimeCloudTransportError } from './hive-runtime-cloud-http-client'

const INITIAL_TIME = Date.parse('2026-08-25T08:00:00.000Z')
const services: HiveRuntimeCloudPresenceService[] = []
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(INITIAL_TIME)
})
afterEach(async () => {
  for (const service of services.splice(0)) {
    await service.stop()
  }
  vi.useRealTimers()
  vi.restoreAllMocks()
})
async function liveFixture() {
  let wall = INITIAL_TIME,
    monotonic = 0
  vi.spyOn(performance, 'now').mockImplementation(() => monotonic)
  const f = fixture(
    claimedState(),
    () => 0,
    () => wall
  )
  services.push(f.service)
  f.service.setRuntimeReady(true)
  await vi.advanceTimersByTimeAsync(0)
  expect(f.service.getState()).toBe('ONLINE')
  const response = await f.client.heartbeat.mock.results[0].value
  return {
    ...f,
    response,
    moveClock: (elapsed: number, wallShift = elapsed) => {
      monotonic += elapsed
      wall += wallShift
    },
    now: () => wall,
    hold: async (patch: Record<string, unknown> = {}) => {
      let release!: () => void
      f.client.heartbeat.mockImplementationOnce(
        () =>
          new Promise((resolveHold) => {
            release = () => resolveHold({ ...response, ...patch, acceptedHeartbeatSeq: 2 })
          })
      )
      f.service.requestHeartbeat()
      await vi.advanceTimersByTimeAsync(0)
      return release
    }
  }
}
describe('canonical accepted Cloud heartbeat lease lifetime', () => {
  it('cannot resurrect the same expired proof if a local forward clock jump is corrected', async () => {
    const f = await liveFixture(),
      release = await f.hold({ duplicate: true })
    try {
      f.moveClock(0, 90_000)
      expect(f.service.getCurrentLeaseContext()).toBeNull()
      f.moveClock(0, -90_000)
      release()
      await vi.advanceTimersByTimeAsync(0)
      expect(f.service.getCurrentLeaseContext()).toBeNull()
    } finally {
      release()
    }
  })
  it('uses the new accepted sequence when the Cloud wall clock moves backwards', async () => {
    const f = await liveFixture(),
      original = f.service.getCurrentLeaseContext()
    f.moveClock(20_000)
    f.client.heartbeat.mockResolvedValueOnce({
      ...f.response,
      acceptedHeartbeatSeq: 2,
      observedAt: f.response.observedAt - 60_000,
      leaseExpiresAt: f.response.observedAt + 30_000
    })
    f.service.requestHeartbeat()
    await vi.advanceTimersByTimeAsync(0)
    expect(f.service.getCurrentLeaseContext()).toEqual(original)
    const release = await f.hold()
    try {
      f.moveClock(70_000)
      expect(f.service.getCurrentLeaseContext()).toEqual(original)
      f.moveClock(20_000)
      expect(f.service.getCurrentLeaseContext()).toBeNull()
    } finally {
      release()
    }
  })
  it('retains the original request budget when a transport retry reuses its signed heartbeat body', async () => {
    const f = await liveFixture()
    f.moveClock(20_000)
    f.client.heartbeat.mockRejectedValueOnce(new HiveRuntimeCloudTransportError())
    f.service.requestHeartbeat()
    await vi.advanceTimersByTimeAsync(0)
    const originalBody = f.client.heartbeat.mock.calls.at(-1)![0]
    f.moveClock(90_001)
    f.client.heartbeat.mockResolvedValueOnce({
      ...f.response,
      acceptedHeartbeatSeq: 2,
      observedAt: f.now(),
      leaseExpiresAt: f.now() + 90_000
    })
    await vi.advanceTimersByTimeAsync(1_000)
    expect(f.client.heartbeat.mock.calls.at(-1)![0].sourceReportedAt).toBe(
      originalBody.sourceReportedAt
    )
    expect(f.service.getCurrentLeaseContext()).toBeNull()
  })
  it('expires the current getter and existing subscribers while renewal is held, despite a live JWT', async () => {
    const f = await liveFixture(),
      observed = vi.fn()
    f.service.subscribeLeaseContext(observed)
    const release = await f.hold()
    try {
      f.moveClock(90_000)
      await vi.advanceTimersByTimeAsync(90_000)
      expect(f.service.getCurrentLeaseContext()).toBeNull()
      expect(observed).toHaveBeenLastCalledWith(null)
    } finally {
      release()
    }
  })
  it('read-through expiry cannot be extended by local clock rollback', async () => {
    const f = await liveFixture(),
      release = await f.hold()
    try {
      f.moveClock(90_000, -60_000)
      expect(f.service.getCurrentLeaseContext()).toBeNull()
    } finally {
      release()
    }
  })
  it('a timely accepted heartbeat extends the same tuple only for its server-reported duration', async () => {
    const f = await liveFixture(),
      original = f.service.getCurrentLeaseContext()
    f.moveClock(20_000)
    f.client.heartbeat.mockResolvedValueOnce({
      ...f.response,
      acceptedHeartbeatSeq: 2,
      observedAt: f.now() + 3_600_000,
      leaseExpiresAt: f.now() + 3_690_000
    })
    f.service.requestHeartbeat()
    await vi.advanceTimersByTimeAsync(0)
    expect(f.service.getCurrentLeaseContext()).toEqual(original)
    const release = await f.hold()
    try {
      f.moveClock(70_000)
      expect(f.service.getCurrentLeaseContext()).toEqual(original)
      f.moveClock(20_000)
      expect(f.service.getCurrentLeaseContext()).toBeNull()
    } finally {
      release()
    }
  })
  it('does not grant the response duration afresh when delivery consumed the entire request budget', async () => {
    const f = await liveFixture(),
      release = await f.hold()
    f.moveClock(90_001)
    release()
    await vi.advanceTimersByTimeAsync(0)
    expect(f.service.getCurrentLeaseContext()).toBeNull()
  })
  it.each(['duplicate', 'stale', 'invalid', 'STALE', 'OFFLINE', 'FENCED', 'tuple'])(
    'cannot manufacture fresh authority from a %s response',
    async (changed) => {
      const f = await liveFixture()
      f.moveClock(20_000)
      const reply = {
        ...f.response,
        acceptedHeartbeatSeq: 2,
        observedAt: f.response.observedAt + 20_000,
        leaseExpiresAt: f.response.leaseExpiresAt + 20_000
      }
      if (changed === 'duplicate') {
        reply.duplicate = true
      } else if (changed === 'stale') {
        reply.acceptedHeartbeatSeq = 1
      } else if (changed === 'invalid') {
        reply.leaseExpiresAt = Number.NaN
      } else if (changed === 'tuple') {
        reply.fencingEpoch++
      } else {
        reply.presence = changed
      }
      f.client.heartbeat.mockResolvedValueOnce(reply)
      f.service.requestHeartbeat()
      await vi.advanceTimersByTimeAsync(0)
      // Keep any retry unresolved so it cannot supply another authenticated heartbeat.
      let release!: () => void
      f.client.heartbeat.mockImplementation(
        () =>
          new Promise((resolveHold) => {
            release = () => resolveHold({ ...reply, acceptedHeartbeatSeq: 3 })
          })
      )
      try {
        f.moveClock(70_000)
        await vi.advanceTimersByTimeAsync(70_000)
        expect(f.service.getCurrentLeaseContext()).toBeNull()
      } finally {
        release?.()
      }
    }
  )
  it('clears original expiry timers and refuses a delayed heartbeat after stop or restart', async () => {
    const f = await liveFixture(),
      observed = vi.fn(),
      release = await f.hold()
    f.service.subscribeLeaseContext(observed)
    f.service.setRuntimeReady(false)
    release()
    await vi.advanceTimersByTimeAsync(0)
    expect(f.service.getCurrentLeaseContext()).toBeNull()
    expect(f.service.getState()).toBe('WAITING_RUNTIME')
    await f.service.stop()
    observed.mockClear()
    f.moveClock(120_000)
    await vi.advanceTimersByTimeAsync(120_000)
    expect(observed).not.toHaveBeenCalled()
  })
})
