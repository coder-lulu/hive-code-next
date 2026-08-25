import { describe, expect, it } from 'vitest'
import { createHiveRuntimeCloudReport } from './hive-runtime-cloud-report'

function runtime(graphStatus: 'ready' | 'reloading' | 'unavailable') {
  return {
    getStartedAt: () => Date.parse('2026-08-25T08:00:00.000Z'),
    getStatus: () => ({ graphStatus })
  }
}

describe('Hive Runtime Cloud report', () => {
  it.each([
    ['ready', 'READY', 'healthy'],
    ['reloading', 'RECOVERING', 'recovery_in_progress'],
    ['unavailable', 'STARTING', 'starting']
  ] as const)(
    'maps %s graph readiness without publishing a web endpoint',
    (graph, state, reason) => {
      const report = createHiveRuntimeCloudReport(runtime(graph), '1.4.178-rc.7')

      expect(report).toEqual({
        runtimeVersion: '1.4.178-rc.7',
        runtimeProtocolVersion: 3,
        capabilities: ['pairing-v3', 'runtime-health-v1'],
        readiness: state,
        readinessReasonCode: reason,
        startedAt: '2026-08-25T08:00:00.000Z',
        connectionCapabilities: ['orca-direct']
      })
      expect(report.capabilities).not.toContain('web-launch-grant-v1')
      expect(report).not.toHaveProperty('webHttpsOrigin')
    }
  )
})
