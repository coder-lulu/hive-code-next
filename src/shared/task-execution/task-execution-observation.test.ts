import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TaskExecutionAcceptedSchema } from './task-execution-receipts'
import { TaskExecutionObservationSchema } from './task-execution-observation'

function observation() {
  const vectors = JSON.parse(
    readFileSync(resolve('integration/contracts/v1/test-vectors.json'), 'utf8')
  )
  const accepted = TaskExecutionAcceptedSchema.parse(vectors.examples.accepted)
  const identity = {
    protocolVersion: accepted.protocolVersion,
    runtimeRecordId: accepted.runtimeRecordId,
    ownershipEpoch: accepted.ownershipEpoch,
    executionId: accepted.executionId,
    executionEpoch: accepted.executionEpoch,
    commandFingerprint: accepted.commandFingerprint
  }
  return {
    ...identity,
    kind: 'execution.observation' as const,
    status: 'accepted' as const,
    accepted,
    events: [
      {
        ...identity,
        kind: 'execution.event' as const,
        eventId: 'event:one',
        sequence: 1,
        status: 'accepted' as const,
        artifactRefs: [],
        recordedAt: accepted.recordedAt
      }
    ],
    cursor: 1,
    lastSequence: 1,
    sessionRef: null,
    result: null
  }
}

describe('task observation envelope validation', () => {
  it('accepts a bound ordered observation', () => {
    expect(TaskExecutionObservationSchema.safeParse(observation()).success).toBe(true)
  })
  it.each(['runtimeRecordId', 'executionId', 'commandFingerprint'] as const)(
    'rejects cross-bound %s',
    (field) => {
      const value = observation()
      expect(
        TaskExecutionObservationSchema.safeParse({
          ...value,
          accepted: {
            ...value.accepted,
            [field]: field === 'commandFingerprint' ? '0'.repeat(64) : 'ref:other'
          }
        }).success
      ).toBe(false)
    }
  )
  it('rejects an impossible cursor', () => {
    expect(TaskExecutionObservationSchema.safeParse({ ...observation(), cursor: 2 }).success).toBe(
      false
    )
  })
  it('rejects a terminal state without a host result', () => {
    expect(
      TaskExecutionObservationSchema.safeParse({ ...observation(), status: 'succeeded' }).success
    ).toBe(false)
  })
  it('rejects an event whose current status disagrees with the envelope', () => {
    const value = observation()
    expect(
      TaskExecutionObservationSchema.safeParse({
        ...value,
        events: [{ ...value.events[0], status: 'running' }]
      }).success
    ).toBe(false)
  })
})
