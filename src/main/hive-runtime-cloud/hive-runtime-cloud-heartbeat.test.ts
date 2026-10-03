import { generateKeyPairSync } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  sendHiveRuntimeCloudHeartbeat,
  type PendingHeartbeat
} from './hive-runtime-cloud-heartbeat'
import { normalizeHeartbeat } from './hive-runtime-cloud-response'
import { withHiveRuntimeRelayHeartbeatReport } from './hive-runtime-cloud-report'
import type { HiveRuntimeCloudReport } from './hive-runtime-cloud-proof'
import type { HiveRuntimeRelayHeartbeatControl } from './relay-host/hive-runtime-relay-heartbeat-types'

const control: HiveRuntimeRelayHeartbeatControl = {
  assignmentId: '20000000-0000-4000-8000-000000000001',
  cellId: 'cell-1',
  cellIncarnationId: '20000000-0000-4000-8000-000000000002',
  assignmentEpoch: 1,
  controlGeneration: 1,
  controlConnectionAcknowledged: true,
  controlCommandAck: {
    sequence: 1,
    commandId: '20000000-0000-4000-8000-000000000003',
    acknowledgedResourceVersion: 1
  },
  sessionTransitions: [],
  activeConnectionCount: 0,
  regionSelectionMode: 'DYNAMIC',
  regionMeasurement: null
}
const fixture = {
  validationTime: Date.parse('2026-09-05T00:00:00Z'),
  input: {
    response: {
      responseVersion: 'runtime-session-control/v1',
      ackedSessionTransitionSequence: 0,
      sessionTransitionResults: [],
      sessionAuthorityUntil: '2026-09-05T00:01:00Z',
      regionMeasurementWindow: null,
      ackedControlSequence: 1,
      controlCommands: [
        {
          sequence: 2,
          commandId: '20000000-0000-4000-8000-000000000004',
          commandType: 'SESSION_REVOKE',
          managedSessionId: '20000000-0000-4000-8000-000000000005',
          assignmentId: control.assignmentId,
          assignmentEpoch: null,
          targetResourceVersion: 2,
          targetControlVersion: 1,
          reason: 'ADMINISTRATIVE',
          targetRegion: null
        }
      ],
      nextControlSequence: 3
    }
  }
}
const base = {
  leaseId: '823e4567-e89b-42d3-a456-426614174000',
  authorityGeneration: 1,
  leaseEpoch: 1,
  fencingEpoch: 1,
  acceptedHeartbeatSeq: 1,
  observedAt: new Date(fixture.validationTime).toISOString(),
  leaseExpiresAt: new Date(fixture.validationTime + 90_000).toISOString(),
  presence: 'ONLINE',
  duplicate: false
}
const report: HiveRuntimeCloudReport = {
  runtimeVersion: '1.0.0',
  runtimeProtocolVersion: 3,
  capabilities: ['pairing-v3', 'runtime-health-v1'],
  readiness: 'READY',
  readinessReasonCode: 'healthy',
  startedAt: base.observedAt,
  connectionCapabilities: ['orca-direct']
}
const keys = generateKeyPairSync('ed25519')
const identity = {
  schemaVersion: 1 as const,
  runtimeInstanceId: '123e4567-e89b-42d3-a456-426614174000',
  privateKeyPkcs8: keys.privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
  publicKey: keys.publicKey.export({ format: 'jwk' }).x!,
  createdAt: 1
}
const lease = {
  ...normalizeHeartbeat(base),
  bootId: '123e4567-e89b-42d3-a456-426614174001',
  nextHeartbeatSeq: 1
}

describe('Hive Runtime Relay signed heartbeat boundary', () => {
  it('parses structured control responses and rejects command gaps or excessive authority', () => {
    const response = { ...base, ...fixture.input.response }
    expect(normalizeHeartbeat(response)).toMatchObject({
      responseVersion: 'runtime-session-control/v1',
      sessionAuthorityUntil: Date.parse(fixture.input.response.sessionAuthorityUntil)
    })
    expect(() => normalizeHeartbeat({ ...response, nextControlSequence: 999 })).toThrow()
    expect(() =>
      normalizeHeartbeat({
        ...response,
        sessionAuthorityUntil: new Date(fixture.validationTime + 120_001).toISOString()
      })
    ).toThrow()
    expect(() =>
      normalizeHeartbeat({
        ...response,
        controlCommands: [{ ...response.controlCommands[0], reason: 'unknown' }]
      })
    ).toThrow()
    const regionWindow = {
      policyVersion: 1,
      generation: 1,
      expiresAt: new Date(fixture.validationTime + 60_000).toISOString(),
      assignmentId: control.assignmentId,
      assignmentEpoch: control.assignmentEpoch,
      incumbentRegion: 'cn-shanghai',
      candidates: [
        { region: 'cn-shanghai', probeUrl: 'https://shanghai.example/' },
        { region: 'cn-beijing', probeUrl: 'https://beijing.example/' }
      ]
    }
    expect(
      normalizeHeartbeat({ ...response, regionMeasurementWindow: regionWindow })
    ).toMatchObject({ regionMeasurementWindow: { generation: 1 } })
    for (const probeUrl of [
      'http://beijing.example/',
      'https://user@beijing.example/',
      'https://beijing.example/probe',
      'https://beijing.example/#fragment'
    ]) {
      expect(() =>
        normalizeHeartbeat({
          ...response,
          regionMeasurementWindow: {
            ...regionWindow,
            candidates: [regionWindow.candidates[0], { region: 'cn-beijing', probeUrl }]
          }
        })
      ).toThrow()
    }
  })

  it('advertises only acknowledged active control while retaining legacy report exactly without a contributor', () => {
    expect(withHiveRuntimeRelayHeartbeatReport(report, null)).toBe(report)
    expect(
      withHiveRuntimeRelayHeartbeatReport(report, { relayControl: control, advertiseRelay: true })
        .connectionCapabilities
    ).toEqual(['orca-direct', 'hive-relay', 'ticket-connect-v2'])
    const inactive = withHiveRuntimeRelayHeartbeatReport(report, {
      relayControl: { ...control, controlConnectionAcknowledged: false },
      advertiseRelay: false
    })
    expect(inactive.connectionCapabilities).toEqual(['orca-direct'])
    expect(inactive.capabilities).toContain('runtime-session-control-v1')
  })

  it('signs the outbox/control ACK and reuses the prepared body after a transport failure', async () => {
    const heartbeat = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(normalizeHeartbeat({ ...base, ...fixture.input.response }))
    let pending: PendingHeartbeat | null = null
    const options = {
      identity,
      authorityId: 'hive-primary',
      lease,
      pending,
      client: {
        heartbeat,
        lookup: vi.fn(),
        register: vi.fn(),
        claim: vi.fn(),
        acquireLease: vi.fn()
      },
      report: withHiveRuntimeRelayHeartbeatReport(report, {
        relayControl: control,
        advertiseRelay: true
      }),
      now: () => fixture.validationTime,
      signal: new AbortController().signal,
      onPrepared: (value: PendingHeartbeat) => {
        pending = value
      },
      assertCurrent: vi.fn(),
      onAccepted: vi.fn()
    }
    await expect(sendHiveRuntimeCloudHeartbeat(options)).rejects.toThrow('offline')
    await sendHiveRuntimeCloudHeartbeat({ ...options, pending, report })
    const first = heartbeat.mock.calls[0][0]
    const second = heartbeat.mock.calls[1][0]
    expect(first.report.relayControl).toEqual(control)
    expect(second.report).toEqual(first.report)
    expect(second.proof.bodySha256).toEqual(first.proof.bodySha256)
    expect(options.onAccepted).toHaveBeenCalledOnce()
  })

  it('never delivers a mismatched lease response to the relay contributor', async () => {
    const accept = vi.fn()
    await expect(
      sendHiveRuntimeCloudHeartbeat({
        identity,
        authorityId: 'hive-primary',
        lease,
        pending: null,
        client: {
          heartbeat: vi.fn().mockResolvedValue({
            ...normalizeHeartbeat({ ...base, ...fixture.input.response }),
            fencingEpoch: 2
          }),
          lookup: vi.fn(),
          register: vi.fn(),
          claim: vi.fn(),
          acquireLease: vi.fn()
        },
        report: withHiveRuntimeRelayHeartbeatReport(report, {
          relayControl: control,
          advertiseRelay: true
        }),
        now: () => fixture.validationTime,
        signal: new AbortController().signal,
        onPrepared: vi.fn(),
        assertCurrent: vi.fn(),
        onAccepted: accept
      })
    ).rejects.toThrow('heartbeat_tuple_mismatch')
    expect(accept).not.toHaveBeenCalled()
  })
})
