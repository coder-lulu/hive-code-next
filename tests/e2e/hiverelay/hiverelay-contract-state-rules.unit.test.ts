import { describe, expect, it } from 'vitest'
import { evaluateSession } from './hiverelay-contract-session-rules'
import {
  evaluateCloseCodes,
  evaluateFrame,
  evaluateReplay
} from './hiverelay-contract-state-rules'
import { evaluatePrivateCommand } from './hiverelay-contract-private-ops'

const transition = {
  sequence: 41,
  transitionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  transitionType: 'ACTIVATE',
  managedSessionId: 'managed-01',
  runtimeSessionId: 'runtime-session-01',
  expectedControlVersion: 3,
  sessionBindingHash: 'A'.repeat(43),
  occurredAt: 1_893_456_000_000,
  reason: 'ACTIVATED'
}

const frameLimits = {
  preAuthJsonBytes: 16_384,
  hostControlJsonBytes: 65_536,
  jsonPlaintextBytes: 4_194_304,
  binaryPlaintextBytes: 8_388_608,
  encryptedPayloadBytes: 8_388_690,
  maskedWireMessageBytes: 8_388_704,
  compressionEnabled: false,
  oversizeCloseCode: 1009
}

const closeCodes = [
  ['PROTOCOL_ERROR', 1002],
  ['FRAME_TOO_LARGE', 1009],
  ['SERVICE_RESTART', 1012],
  ['CAPACITY_EXCEEDED', 1013],
  ['AUTH_REQUIRED', 4401],
  ['ORIGIN_REJECTED', 4403],
  ['AUTH_TIMEOUT', 4408],
  ['REPLAY_DETECTED', 4409],
  ['STALE_BINDING', 4410],
  ['HOST_UNAVAILABLE', 4411],
  ['RELAY_UNAVAILABLE', 4412],
  ['DRAINING', 4413],
  ['UPGRADE_REQUIRED', 4426]
].map(([symbol, code]) => ({ symbol: symbol as string, code: code as number }))

describe('HiveRelay managed-session rules', () => {
  it('rejects every source/event pair absent from the frozen state table', () => {
    expect(
      evaluateSession({
        highestContiguousAck: 40,
        currentStatus: 'PENDING_ACTIVATION',
        currentControlVersion: 3,
        transition: { ...transition, transitionType: 'CLOSE', reason: 'CLIENT_CLOSED' }
      })
    ).toEqual(['REJECT', 'REJECTED_ILLEGAL_STATE'])
  })

  it.each([
    [
      { sequence: 41, transitionId: transition.transitionId, bodySha256: 'a'.repeat(64) },
      {
        sequence: 41,
        transitionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        bodySha256: 'b'.repeat(64)
      }
    ],
    [
      { sequence: 41, transitionId: transition.transitionId, bodySha256: 'a'.repeat(64) },
      { sequence: 42, transitionId: transition.transitionId, bodySha256: 'b'.repeat(64) }
    ]
  ])('rejects a changed body when either replay identity is reused', (stored, replay) => {
    expect(evaluateSession({ highestContiguousAck: 41, stored, replay })).toEqual([
      'REJECT',
      'TRANSITION_REPLAY_CONFLICT'
    ])
  })

  it('rejects an event/reason mismatch', () => {
    expect(
      evaluateSession({
        highestContiguousAck: 40,
        currentStatus: 'PENDING_ACTIVATION',
        currentControlVersion: 3,
        transition: { ...transition, reason: 'CLIENT_CLOSED' }
      })
    ).toEqual(['REJECT', 'INVALID_TRANSITION_REASON'])
  })

  it('returns the stored adjudication only with an unchanged identity and covering ACK', () => {
    expect(
      evaluateSession({
        highestContiguousAck: 41,
        stored: {
          sequence: 41,
          transitionId: transition.transitionId,
          bodySha256: 'a'.repeat(64),
          adjudication: {
            sequence: 41,
            transitionId: transition.transitionId,
            verdict: 'APPLIED',
            stored: true,
            resultingStatus: 'ACTIVE',
            resultingControlVersion: 4
          }
        },
        replay: {
          sequence: 41,
          transitionId: transition.transitionId,
          bodySha256: 'a'.repeat(64)
        },
        expectedHighestContiguousAck: 41
      })
    ).toEqual(['ACCEPT', 'STORED_ADJUDICATION'])
  })

  it('rejects an impossible stored gap adjudication on exact replay', () => {
    expect(
      evaluateSession({
        highestContiguousAck: 41,
        stored: {
          sequence: 41,
          transitionId: transition.transitionId,
          bodySha256: 'a'.repeat(64),
          adjudication: {
            sequence: 41,
            transitionId: transition.transitionId,
            verdict: 'SEQUENCE_GAP',
            stored: true,
            resultingStatus: 'ACTIVE',
            resultingControlVersion: 4
          }
        },
        replay: {
          sequence: 41,
          transitionId: transition.transitionId,
          bodySha256: 'a'.repeat(64)
        },
        expectedHighestContiguousAck: 41
      })
    ).toEqual(['REJECT', 'INVALID_SESSION_TRANSITION'])
  })

  it('keeps a gap and all later batch entries unstored and unacknowledged', () => {
    const later = {
      ...transition,
      sequence: 43,
      transitionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      reason: 'CLIENT_CLOSED'
    }
    expect(
      evaluateSession({
        highestContiguousAck: 40,
        currentStatus: 'PENDING_ACTIVATION',
        currentControlVersion: 3,
        transitions: [{ ...transition, sequence: 42 }, later],
        expectedResponse: {
          highestContiguousAck: 40,
          adjudications: [
            {
              sequence: 42,
              transitionId: transition.transitionId,
              verdict: 'SEQUENCE_GAP',
              stored: false,
              resultingStatus: 'PENDING_ACTIVATION',
              resultingControlVersion: 3
            },
            {
              sequence: 43,
              transitionId: later.transitionId,
              verdict: 'SEQUENCE_GAP',
              stored: false,
              resultingStatus: 'PENDING_ACTIVATION',
              resultingControlVersion: 3
            }
          ]
        }
      })
    ).toEqual(['REJECT', 'SEQUENCE_GAP'])
  })
})

describe('HiveRelay private command timing', () => {
  const baseCommand = {
    type: 'cell-lifecycle-command',
    v: 2,
    commandType: 'INCARNATION_DRAIN',
    commandId: '17171717-1717-4717-8717-171717171717',
    cellId: 'cell-01',
    targetIncarnationId: '22222222-2222-4222-8222-222222222222',
    lifecycleGeneration: 12,
    issuedAt: 1_000_000,
    deadlineAt: 1_120_000
  } as const

  it('enforces freshness and the exact lifecycle deadline', () => {
    expect(evaluatePrivateCommand({ commands: [baseCommand] }, 1_000_000)).toEqual([
      'ACCEPT',
      'VALID_PRIVATE_COMMAND'
    ])
    expect(
      evaluatePrivateCommand({ commands: [{ ...baseCommand, issuedAt: 969_999 }] }, 1_000_000)
    ).toEqual(['REJECT', 'COMMAND_STALE'])
    expect(
      evaluatePrivateCommand({ commands: [{ ...baseCommand, issuedAt: 1_030_001 }] }, 1_000_000)
    ).toEqual(['REJECT', 'COMMAND_NOT_YET_VALID'])
    expect(
      evaluatePrivateCommand({ commands: [{ ...baseCommand, deadlineAt: 1_120_001 }] }, 1_000_000)
    ).toEqual(['REJECT', 'INVALID_DEADLINE'])
  })
})

describe('HiveRelay fixture input strictness', () => {
  it('rejects empty or incomplete frame corpora', () => {
    expect(evaluateFrame({ frames: [] }, { frameLimits, closeCodes })).toEqual([
      'REJECT',
      'INVALID_FRAME_LIMIT'
    ])
    expect(
      evaluateFrame(
        {
          frames: [{ limit: 'preAuthJsonBytes', bytes: frameLimits.preAuthJsonBytes }],
          compressionRequested: false
        },
        { frameLimits, closeCodes }
      )
    ).toEqual(['REJECT', 'INVALID_FRAME_LIMIT'])
  })

  it('rejects missing and duplicate close-code mappings', () => {
    expect(evaluateCloseCodes({ mappings: [] }, { frameLimits, closeCodes })).toEqual([
      'REJECT',
      'INVALID_CLOSE_CODE'
    ])
    expect(
      evaluateCloseCodes(
        { mappings: [...closeCodes.slice(0, -1), closeCodes[0]] },
        { frameLimits, closeCodes }
      )
    ).toEqual(['REJECT', 'INVALID_CLOSE_CODE'])
  })

  it('compares admission bindings structurally instead of by key insertion order', () => {
    const expected = { cellId: 'cell-01', assignmentEpoch: 5 }
    const actual = { assignmentEpoch: 5, cellId: 'cell-01' }
    expect(
      evaluateReplay('admission-replay', {
        expected,
        actual,
        priorState: 'UNUSED',
        attempts: 1
      })
    ).toEqual(['ACCEPT', 'FIRST_USE'])
  })
})
