import { describe, expect, it } from 'vitest'
import { resolveOrchestrationHeartbeatMinutes } from './orchestration-heartbeat'

describe('resolveOrchestrationHeartbeatMinutes', () => {
  it.each([0, 61, 2.5, Number.NaN])('falls back to 5 for a malformed interval (%s)', (value) => {
    expect(
      resolveOrchestrationHeartbeatMinutes({ orchestrationHeartbeatIntervalMinutes: value })
    ).toBe(5)
  })
})

it('keeps heartbeats on by default and respects an explicit opt-out', () => {
  expect(resolveOrchestrationHeartbeatMinutes(undefined)).toBe(5)
  expect(resolveOrchestrationHeartbeatMinutes({})).toBe(5)
  expect(resolveOrchestrationHeartbeatMinutes({ orchestrationHeartbeatsEnabled: false })).toBeNull()
  expect(resolveOrchestrationHeartbeatMinutes({ orchestrationHeartbeatIntervalMinutes: 12 })).toBe(
    12
  )
})
