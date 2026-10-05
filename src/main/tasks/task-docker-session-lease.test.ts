import { describe, expect, it } from 'vitest'
import { applyAgentSessionRestartAdjudication } from '../runtime/agent-session-restart-lease-transitions'
import { releaseAgentSessionOwnerAfterSurfaceClose } from '../runtime/agent-session-surface-release-transition'
import { renewAgentSessionLease } from '../runtime/agent-session-lease-transitions'
import { TASK_TEST_NOW } from './task-execution.test-fixture'
import { dockerSessionFixture, executionWitness } from './task-docker-session-owner.test-fixture'

describe('Task execution owner lease evidence', () => {
  it.each(['pid-absent', 'exit-observed', 'reservation-unused'] as const)(
    'does not release a Task on CLI %s evidence',
    async (outcome) => {
      const fixture = await dockerSessionFixture()
      const record = fixture.record()
      const next = applyAgentSessionRestartAdjudication({
        record: { ...record, lease: { ...record.lease, unreconciled: true } },
        probe: { outcome },
        now: TASK_TEST_NOW + 1000
      })
      expect(next.lease).toMatchObject({
        runtimeFence: record.lease.runtimeFence,
        handoffStage: 'recovering',
        unreconciled: true,
        deathEvidence: null
      })
    }
  )
  it('does not free an ownerless released Task through the personal shortcut', async () => {
    const fixture = await dockerSessionFixture(false)
    const record = fixture.record()
    const next = applyAgentSessionRestartAdjudication({
      record: {
        ...record,
        lease: {
          ...record.lease,
          ownerProcess: null,
          reservedSpawnToken: null,
          claimStatus: 'released',
          unreconciled: true
        }
      },
      probe: { outcome: 'indeterminate', reason: 'missing CID proof' },
      now: TASK_TEST_NOW + 1000
    })
    expect(next.lease).toMatchObject({ handoffStage: 'recovering', unreconciled: true })
  })
  it('accepts actual execution-host life without pretending the CLI PID matched', async () => {
    const fixture = await dockerSessionFixture()
    const record = fixture.record()
    const next = renewAgentSessionLease({
      record,
      fence: record.lease.runtimeFence,
      childProbe: { outcome: 'execution-host-live', witness: executionWitness(record) },
      now: TASK_TEST_NOW + 1000,
      leaseTtlMs: 10000
    })
    expect(next.lease.lastRenewedAt).toBe(TASK_TEST_NOW + 1000)
  })
  it('rejects a surface-close CLI exit as Task writer death', async () => {
    const fixture = await dockerSessionFixture()
    const record = fixture.record()
    expect(() =>
      releaseAgentSessionOwnerAfterSurfaceClose({
        record,
        expectedFence: record.lease.runtimeFence,
        now: TASK_TEST_NOW + 1000
      })
    ).toThrow('agent_session_ownership_unknown')
  })
  it.each(['root-exit-observed', 'exit-proven', 'processless', 'unproven'] as const)(
    'keeps a failed ownerless Task %s attempt in recovery until CID exit',
    async (exitProof) => {
      const fixture = await dockerSessionFixture(false)
      const record = fixture.record()
      const next = await fixture.store.settleFailedAcquisition({
        sessionId: record.sessionId,
        fence: record.lease.runtimeFence,
        spawnToken: record.lease.reservedSpawnToken ?? '',
        callerKey: fixture.request.operation.callerKey,
        operationId: fixture.request.operation.operationId,
        outcome: {
          status: 'failed',
          code: 'agent_session_operation_invalid',
          message: 'synthetic failure'
        },
        exitProof,
        now: TASK_TEST_NOW + 1000
      })
      expect(next.lease).toMatchObject({
        runtimeFence: record.lease.runtimeFence,
        handoffStage: 'recovering',
        claimStatus: 'reserved',
        deathEvidence: null
      })
    }
  )
})
