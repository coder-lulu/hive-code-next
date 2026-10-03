import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { evaluateHeartbeatControl } from './hiverelay-contract-heartbeat'
import { parseHiveRelayContractFixture } from './hiverelay-contract-validator'

function fixture() {
  return parseHiveRelayContractFixture(
    readFileSync(
      new URL(
        '../../../config/hiverelay-contract/fixtures/v2/heartbeat-legacy-shape-valid.json',
        import.meta.url
      ),
      'utf8'
    )
  )
}

it('accepts the current signed native-session heartbeat fixture', () => {
  const value = fixture()
  expect(evaluateHeartbeatControl(value.input, value.validationTime)).toEqual([
    'ACCEPT',
    'VALID_LEGACY_HEARTBEAT_SHAPE'
  ])
})

it.each([undefined, 'not-a-session'])(
  'rejects a heartbeat with invalid session %s',
  (sessionId) => {
    const value = fixture()
    const request = value.input.legacyRequest
    if (!request || typeof request !== 'object' || !('cloudSessionId' in request)) {
      throw new Error('current_heartbeat_fixture_missing_native_session')
    }
    if (sessionId === undefined) {
      delete request.cloudSessionId
    } else {
      request.cloudSessionId = sessionId
    }
    expect(evaluateHeartbeatControl(value.input, value.validationTime)).toEqual([
      'REJECT',
      'INVALID_LEGACY_HEARTBEAT_SHAPE'
    ])
  }
)

it('accepts the implemented Web session display metadata capability', () => {
  const value = fixture()
  const request = value.input.legacyRequest
  if (!request || typeof request !== 'object' || !('report' in request)) {
    throw new Error('current_heartbeat_fixture_missing_report')
  }
  const report = request.report
  if (!report || typeof report !== 'object' || !('capabilities' in report)) {
    throw new Error('current_heartbeat_fixture_missing_capabilities')
  }
  report.capabilities = [
    'connection-ticket-v1',
    'pairing-v3',
    'runtime-health-v1',
    'web-session-display-metadata-v1',
    'web-launch-grant-v1'
  ]
  expect(evaluateHeartbeatControl(value.input, value.validationTime)[0]).toBe('ACCEPT')
})
