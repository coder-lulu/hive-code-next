import { describe, expect, it, vi } from 'vitest'
import { agentSessionOperationKey } from '../../shared/agent-session-operation-ledger'
import { AgentSessionRefusalError } from '../../shared/agent-session-wire-refusals'
import {
  commitAgentSessionReservation,
  applyAgentSessionReservation
} from '../runtime/agent-session-reservation-admission'
import { serializeAgentSessionStoreState } from '../runtime/agent-session-store-serialization'
import { emptyState } from '../runtime/agent-session-store-parsing'
import { TaskExecutionRecordSchema, taskExecutionIdentity } from './task-execution-record'
import { taskStructuredFixture } from './task-structured-reservation.test-fixture'
import {
  assertTaskStructuredAcquisition,
  assertTaskStructuredReservation,
  bindTaskStructuredReservation
} from './task-structured-reservation'

type Fixture = ReturnType<typeof taskStructuredFixture>
function reserve(fixture: Fixture) {
  return commitAgentSessionReservation(fixture.state, fixture.request, 30_000)
}
function bound() {
  const fixture = taskStructuredFixture()
  return { ...fixture, record: reserve(fixture).record }
}
function expectUnchanged(fixture: Fixture, run: () => void) {
  const before = serializeAgentSessionStoreState(fixture.state)
  expect(run).toThrowError(AgentSessionRefusalError)
  expect(serializeAgentSessionStoreState(fixture.state)).toBe(before)
}
function setOuter(fixture: Fixture, patch: Partial<Fixture['outer']>) {
  fixture.state.operations.set(
    agentSessionOperationKey(fixture.outer.callerKey, fixture.outer.operationId),
    { ...fixture.outer, ...patch }
  )
}

describe('task reservation admission against original state', () => {
  it('binds the original claimed outer operation at the first reserved fence', () => {
    const fixture = taskStructuredFixture()
    const originalEvents = structuredClone(fixture.task.events)
    const { record, disposition, operationRow } = reserve(fixture)
    const task = fixture.state.taskExecutions!.get(fixture.key)!
    expect(disposition).toBe('created')
    expect(record.taskSource).toEqual(fixture.origin.source)
    expect(task.structuredBinding).toMatchObject({
      source: fixture.origin.source,
      operationCallerKey: 'acct-runtime:local:test',
      operationId: fixture.command.operationId,
      launchFingerprint: fixture.origin.launchFingerprint,
      attachOperationId: fixture.request.operation.operationId,
      attachFingerprint: operationRow.fingerprint,
      sessionId: record.sessionId,
      runtimeFence: 1,
      spawnToken: fixture.request.spawnToken,
      accountHome: fixture.request.accountHome,
      location: fixture.request.location
    })
    expect(task.revision).toBe(fixture.task.revision + 1)
    expect(task.events).toEqual(originalEvents)
    expect(task.status).toBe('accepted')
    expect(operationRow.outcome.status).toBe('pending')
    expect(() =>
      assertTaskStructuredAcquisition(fixture.state, fixture.request, record)
    ).not.toThrow()
  })
  it('replays the complete original binding without another task revision or token', () => {
    const fixture = taskStructuredFixture()
    const token = vi.fn(() => 'task-spawn-from-supplier')
    fixture.request.spawnToken = token
    const first = reserve(fixture)
    const task = fixture.state.taskExecutions!.get(fixture.key)
    const next = reserve(fixture)
    expect(next.disposition).toBe('replayed')
    expect(next.record).toBe(first.record)
    expect(fixture.state.taskExecutions!.get(fixture.key)).toBe(task)
    expect(token).toHaveBeenCalledTimes(1)
    expect(fixture.validate).toHaveBeenCalledTimes(4)
  })
  it('runs the current authorizer before task or operation lookup and before pruning', () => {
    const fixture = taskStructuredFixture()
    const readTask = vi.spyOn(fixture.state.taskExecutions!, 'get')
    const readOperation = vi.spyOn(fixture.state.operations, 'get')
    fixture.validate.mockImplementation(() => {
      throw new Error('authorization-revoked')
    })
    const operations = fixture.state.operations
    expect(() => reserve(fixture)).toThrow('authorization-revoked')
    expect(readTask).not.toHaveBeenCalled()
    expect(readOperation).not.toHaveBeenCalled()
    expect(fixture.state.operations).toBe(operations)
  })
  it.each([undefined, null, false, 'callback', 1])(
    'requires a callable task origin validate: %j',
    (validate) => {
      const fixture = taskStructuredFixture()
      Object.assign(fixture.origin, { validate })
      expectUnchanged(fixture, () => reserve(fixture))
    }
  )
  it('rejects a null origin rather than treating it as personal', () => {
    const fixture = taskStructuredFixture()
    Object.assign(fixture.request, { taskOrigin: null })
    expectUnchanged(fixture, () => reserve(fixture))
  })
  it.each(['pending', 'succeeded', 'failed'] as const)(
    'requires claimed outer unknown, not %s',
    (status) => {
      const fixture = taskStructuredFixture()
      Object.assign(fixture.outer, {
        outcome:
          status === 'succeeded'
            ? { status, sessionId: 'session-task-one' }
            : status === 'failed'
              ? { status, code: 'failed' }
              : { status }
      })
      expectUnchanged(fixture, () => reserve(fixture))
    }
  )
  it.each([
    (f: Fixture) => setOuter(f, { fingerprint: 'd'.repeat(64) }),
    (f: Fixture) => setOuter(f, { callerKey: 'caller:wrong' }),
    (f: Fixture) => setOuter(f, { operationId: `1800000000000-${'d'.repeat(32)}` }),
    (f: Fixture) => setOuter(f, { expiresAt: f.request.now }),
    (f: Fixture) => f.state.operations.clear(),
    (f: Fixture) => {
      f.state.taskRecoveryBlocked = true
    },
    (f: Fixture) => f.state.taskExecutions!.clear(),
    (f: Fixture) => {
      f.origin.source = { ...f.origin.source, ownershipEpoch: f.origin.source.ownershipEpoch + 1 }
    },
    (f: Fixture) => {
      f.origin.source = { ...f.origin.source, commandFingerprint: 'd'.repeat(64) }
    },
    (f: Fixture) => {
      f.request.operation = { ...f.request.operation, callerKey: 'personal:wrong' }
    },
    (f: Fixture) => {
      f.request.operation = {
        ...f.request.operation,
        operationId: `1800000000000-${'d'.repeat(32)}`
      }
    },
    (f: Fixture) => {
      f.request.handoffOperationId = null
    },
    (f: Fixture) => {
      f.request.location = { ...f.request.location, workspaceId: 'workspace:wrong' }
    },
    (f: Fixture) => {
      f.request.location = { ...f.request.location, workspaceKind: 'git-worktree' }
    },
    (f: Fixture) => {
      f.request.location = { ...f.request.location, executionHostId: 'ssh:host' }
    },
    (f: Fixture) => {
      f.request.location = { ...f.request.location, wslDistro: 'Ubuntu' }
    },
    (f: Fixture) => {
      f.request.provider = 'claude'
    },
    (f: Fixture) => {
      f.request.accountHome = { variable: 'CLAUDE_CONFIG_DIR', path: '/managed/wrong' }
    },
    (f: Fixture) => {
      f.request.accountHome = { variable: 'CODEX_HOME', path: '' }
    },
    (f: Fixture) => {
      f.request.expectedFence = 4
    }
  ])(
    'refuses detached task identity, operation or local launch inputs without state changes',
    (mutate) => {
      const fixture = taskStructuredFixture()
      mutate(fixture)
      expectUnchanged(fixture, () => reserve(fixture))
    }
  )
  it('refuses cancellation and every non-dispatching task state', () => {
    for (const status of [
      'cancel_requested',
      'outcome_unknown',
      'running',
      'waiting_input'
    ] as const) {
      const fixture = taskStructuredFixture()
      const task = TaskExecutionRecordSchema.parse({
        ...fixture.task,
        status,
        cancellationKey: status === 'cancel_requested' ? 'cancellation:test' : null,
        events: [
          ...fixture.task.events,
          { ...fixture.task.events[0], eventId: `event:${status}`, sequence: 2, status }
        ]
      })
      fixture.state.taskExecutions!.set(fixture.key, task)
      expectUnchanged(fixture, () => reserve(fixture))
    }
    const fixture = taskStructuredFixture()
    fixture.state.taskExecutions!.set(fixture.key, { ...fixture.task, dispatch: 'not_dispatched' })
    expectUnchanged(fixture, () => reserve(fixture))
  })
  it('requires pending matching inner row and an exact fresh reserved claim', () => {
    for (const changed of [
      { claimStatus: 'live' },
      { handoffStage: null },
      {
        ownerProcess: {
          hostId: 'local',
          pid: 1,
          processStartTimeMs: null,
          spawnToken: 'task-spawn-one'
        }
      },
      { reservedSpawnToken: null },
      { claimKeyId: 'claim-key-fork' },
      { unreconciled: true },
      { handoffOperationId: 'wrong-operation' }
    ]) {
      const fixture = taskStructuredFixture()
      const record = applyAgentSessionReservation(fixture.state, fixture.request, 30_000).record
      Object.assign(record.lease, changed)
      expectUnchanged(fixture, () =>
        bindTaskStructuredReservation(fixture.state, fixture.request, record, fixture.inner)
      )
    }
    for (const changed of [
      { fingerprint: 'd'.repeat(64) },
      { callerKey: 'wrong:caller' },
      { outcome: { status: 'unknown' } },
      { outcome: { status: 'succeeded', sessionId: 'session-task-one' } }
    ]) {
      const fixture = taskStructuredFixture()
      const record = applyAgentSessionReservation(fixture.state, fixture.request, 30_000).record
      Object.assign(fixture.inner, changed)
      expectUnchanged(fixture, () =>
        bindTaskStructuredReservation(fixture.state, fixture.request, record, fixture.inner)
      )
    }
  })
  it('refuses a valid task with a settled result', () => {
    const fixture = bound()
    const current = fixture.state.taskExecutions!.get(fixture.key)!
    const result = {
      ...taskExecutionIdentity(current.command),
      commandFingerprint: current.commandFingerprint,
      recordedAt: current.accepted.recordedAt,
      kind: 'execution.result',
      status: 'failed',
      receiptId: 'result:test',
      outcomeRef: 'outcome:test',
      artifactRefs: [],
      usageFactRefs: [],
      stopProof: {
        proofRef: 'proof:test',
        evidenceKind: 'stopped',
        managedToolsSettled: true,
        writersFenced: true,
        recordedAt: current.accepted.recordedAt
      }
    }
    const task = TaskExecutionRecordSchema.parse({
      ...current,
      result,
      status: 'failed',
      events: [
        ...current.events,
        { ...current.events[0], sequence: 2, eventId: 'event:failed', status: 'failed' }
      ]
    })
    fixture.state.taskExecutions!.set(fixture.key, task)
    expectUnchanged(fixture, () => reserve(fixture))
    expectUnchanged(fixture, () =>
      assertTaskStructuredAcquisition(fixture.state, fixture.request, fixture.record)
    )
  })
  it('preserves ordinary personal reservations even alongside an active task', () => {
    for (const state of [emptyState('local'), taskStructuredFixture().state]) {
      const { request } = taskStructuredFixture()
      delete request.taskOrigin
      request.sessionId = 'session-personal-one'
      request.operation = { ...request.operation, operationId: `1800000000000-${'e'.repeat(32)}` }
      request.handoffOperationId = request.operation.operationId
      const before = new Map(state.taskExecutions)
      const result = commitAgentSessionReservation(state, request, 30_000)
      expect(result.record.taskSource).toBeUndefined()
      expect(state.taskExecutions).toEqual(before)
      expect(() => assertTaskStructuredAcquisition(state, request, result.record)).not.toThrow()
      Object.assign(result.record, { taskSource: undefined })
      expect(() => assertTaskStructuredAcquisition(state, request, result.record)).toThrowError(
        AgentSessionRefusalError
      )
    }
  })
})

describe('task reservation and acquisition forks', () => {
  it('refuses requests stripped of task origin, including stripped durable source', () => {
    for (const stripSource of [false, true]) {
      const fixture = bound()
      delete fixture.request.taskOrigin
      if (stripSource) {
        delete fixture.record.taskSource
      }
      expectUnchanged(fixture, () =>
        assertTaskStructuredReservation(fixture.state, fixture.request)
      )
      expectUnchanged(fixture, () =>
        assertTaskStructuredAcquisition(fixture.state, fixture.request, fixture.record)
      )
    }
    const fixture = taskStructuredFixture()
    delete fixture.request.taskOrigin
    fixture.request.sessionId = 'session-personal-one'
    fixture.request.operation.callerKey = 'personal:wrong'
    expectUnchanged(fixture, () => reserve(fixture))
  })
  it.each([
    (f: ReturnType<typeof bound>) => {
      f.request.sessionId = 'session-task-fork'
    },
    (f: ReturnType<typeof bound>) => {
      f.request.accountHome = { variable: 'CODEX_HOME', path: '/managed/fork-home' }
    },
    (f: ReturnType<typeof bound>) => {
      f.request.expectedFence = 9
    },
    (f: ReturnType<typeof bound>) => {
      f.request.spawnToken = 'task-spawn-fork'
    },
    (f: ReturnType<typeof bound>) => {
      f.request.operation = { ...f.request.operation, fingerprint: 'c'.repeat(64) }
    },
    (f: ReturnType<typeof bound>) => {
      delete f.record.taskSource
    },
    (f: ReturnType<typeof bound>) => {
      f.record.lease.runtimeFence += 1
    },
    (f: ReturnType<typeof bound>) => {
      f.record.lease.reservedSpawnToken = 'task-spawn-fork'
    },
    (f: ReturnType<typeof bound>) => {
      f.record.accountHome = { variable: 'CODEX_HOME', path: '/managed/fork-home' }
    },
    (f: ReturnType<typeof bound>) => {
      f.record.sessionId = 'session-task-fork'
    },
    (f: ReturnType<typeof bound>) => {
      f.state.records.clear()
    },
    (f: ReturnType<typeof bound>) => {
      f.state.operations.delete(agentSessionOperationKey(f.inner.callerKey, f.inner.operationId))
    }
  ])('refuses changed binding identity before a replay can reserve a new owner', (mutate) => {
    const fixture = bound()
    mutate(fixture)
    expectUnchanged(fixture, () => reserve(fixture))
    expectUnchanged(fixture, () =>
      assertTaskStructuredAcquisition(fixture.state, fixture.request, fixture.record)
    )
  })
  it('refuses an original binding whose owner was released, without minting a cold replacement token', () => {
    const fixture = bound()
    fixture.record.lease.claimStatus = 'released'
    fixture.record.lease.handoffStage = null
    const mint = vi.fn(() => 'cold-replacement')
    fixture.request.spawnToken = mint
    expectUnchanged(fixture, () => reserve(fixture))
    expect(mint).not.toHaveBeenCalled()
  })
  it('uses fresh current state, validates again, and refuses stale passed records', () => {
    const fixture = bound()
    const stale = structuredClone(fixture.record)
    fixture.state.records.set(stale.sessionId, {
      ...stale,
      lease: { ...stale.lease, runtimeFence: stale.lease.runtimeFence + 1 }
    })
    expectUnchanged(fixture, () =>
      assertTaskStructuredAcquisition(fixture.state, fixture.request, stale)
    )
    fixture.state.records.set(stale.sessionId, stale)
    fixture.validate.mockImplementation(() => {
      throw new Error('authorization-revoked')
    })
    expect(() => assertTaskStructuredAcquisition(fixture.state, fixture.request, stale)).toThrow(
      'authorization-revoked'
    )
  })
  it('never acquires an unbound old task or a settled inner operation', () => {
    const fixture = taskStructuredFixture()
    const record = applyAgentSessionReservation(fixture.state, fixture.request, 30_000).record
    fixture.state.records.set(record.sessionId, record)
    expectUnchanged(fixture, () =>
      assertTaskStructuredAcquisition(fixture.state, fixture.request, record)
    )
    const started = bound()
    started.state.operations.set(
      agentSessionOperationKey(started.inner.callerKey, started.inner.operationId),
      { ...started.inner, outcome: { status: 'succeeded', sessionId: started.record.sessionId } }
    )
    expectUnchanged(started, () =>
      assertTaskStructuredAcquisition(started.state, started.request, started.record)
    )
  })
})
