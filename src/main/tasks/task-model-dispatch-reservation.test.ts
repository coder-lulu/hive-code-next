import { describe, expect, it } from 'vitest'
import { agentSessionLeaseAdmitsWriter } from '../../shared/agent-session-lease-adjudication'
import { emptyState } from '../runtime/agent-session-store-parsing'
import {
  loadHiveRuntimeState,
  serializeHiveRuntimeState,
  writeHiveRuntimeState
} from '../runtime/agent-session-hive-state-rows'
import Database from '../sqlite/sync-database'
import { TaskExecutionRecordSchema } from './task-execution-record'
import { TASK_MODEL_REQUEST_LIMIT } from './task-model-channel-protocol'
import { reserveTaskModelDispatch } from './task-model-dispatch-reservation'
import { taskModelDispatchFixture } from './task-model-dispatch.test-fixture'

function coldTask(fixture: ReturnType<typeof taskModelDispatchFixture>, malformed = false) {
  const db = new Database(':memory:')
  try {
    db.exec('CREATE TABLE agent_session_store_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    // Malformed rows bypass the writer guard to exercise the original database reader.
    const json = malformed
      ? JSON.stringify({
          hostId: fixture.state.hostId,
          hiveSessions: {},
          taskExecutions: Object.fromEntries(fixture.state.taskExecutions ?? [])
        })
      : serializeHiveRuntimeState(fixture.state)
    writeHiveRuntimeState(db, json)
    const loaded = emptyState('local')
    loadHiveRuntimeState(db, loaded)
    return loaded.taskExecutions?.get(fixture.key)
  } finally {
    db.close()
  }
}

describe('private original Task model-dispatch counter', () => {
  it('reads an absent historical counter with an original live owner', () => {
    const fixture = taskModelDispatchFixture()
    expect(TaskExecutionRecordSchema.safeParse(fixture.task).success).toBe(true)
    expect(Object.hasOwn(fixture.task, 'modelDispatchAttempts')).toBe(false)
    expect(agentSessionLeaseAdmitsWriter(fixture.record.lease)).toBe(true)
    expect(fixture.task.command.agent).toBe('hivecode')
  })
  it.each([0, TASK_MODEL_REQUEST_LIMIT])('reads a bound integer counter of %s', (count) => {
    const { task } = taskModelDispatchFixture()
    expect(
      TaskExecutionRecordSchema.safeParse({ ...task, modelDispatchAttempts: count }).success
    ).toBe(true)
  })
  it.each([
    undefined,
    null,
    -1,
    0.5,
    TASK_MODEL_REQUEST_LIMIT + 1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    '1',
    {},
    []
  ])('rejects a present malformed counter %s', (count) => {
    const { task } = taskModelDispatchFixture()
    expect(
      TaskExecutionRecordSchema.safeParse({ ...task, modelDispatchAttempts: count }).success
    ).toBe(false)
  })
  it('rejects a counter without the original structured binding', () => {
    const { task } = taskModelDispatchFixture()
    const unbound = { ...task, modelDispatchAttempts: 0 }
    delete unbound.structuredBinding
    expect(TaskExecutionRecordSchema.safeParse(unbound).success).toBe(false)
  })
  it.each([null, -1, 0.5, TASK_MODEL_REQUEST_LIMIT + 1, '1'])(
    'rejects malformed counter %s in the original cold parser',
    (count) => {
      const fixture = taskModelDispatchFixture()
      Object.assign(fixture.task, { modelDispatchAttempts: count })
      expect(() => coldTask(fixture, true)).toThrow()
    }
  )
  it('keeps absent old private data readable in the original cold parser', () => {
    const fixture = taskModelDispatchFixture()
    expect(coldTask(fixture)).toEqual(fixture.task)
  })
})

type Fixture = ReturnType<typeof taskModelDispatchFixture>
type Mutation = [string, (fixture: Fixture) => void, string]

describe('fresh original Task and Session writer admission', () => {
  it.each(['managed_copy', 'managed_worktree'] as const)(
    'uses the original %s workspace and a proved owner without changing the input',
    (isolation) => {
      const initial = taskModelDispatchFixture()
      const fixture = taskModelDispatchFixture({
        workspace: { ...initial.task.workspace, isolation }
      })
      const before = structuredClone(fixture.state)
      const next = reserveTaskModelDispatch(fixture.state, fixture.task, fixture.binding)
      expect(next).toEqual({ ...fixture.task, modelDispatchAttempts: 1 })
      expect(fixture.state).toEqual(before)
    }
  )
  it('allows the original running bound source', () => {
    const fixture = taskModelDispatchFixture({ bound: true })
    expect(reserveTaskModelDispatch(fixture.state, fixture.task, fixture.binding)).toEqual({
      ...fixture.task,
      modelDispatchAttempts: 1
    })
  })
  const mutations: Mutation[] = [
    [
      'recovery blocked',
      ({ state }) => {
        state.taskRecoveryBlocked = true
      },
      'OUTCOME_UNKNOWN'
    ],
    [
      'cancel key',
      ({ task }) => {
        task.cancellationKey = 'cancel:test'
      },
      'OUTCOME_UNKNOWN'
    ],
    [
      'not dispatched',
      ({ task }) => {
        task.dispatch = 'not_dispatched'
      },
      'OUTCOME_UNKNOWN'
    ],
    [
      'unknown',
      ({ task }) => {
        task.status = 'outcome_unknown'
        for (const event of task.events) {
          event.status = task.status
        }
      },
      'OUTCOME_UNKNOWN'
    ],
    [
      'waiting input',
      ({ task }) => {
        task.status = 'waiting_input'
        for (const event of task.events) {
          event.status = task.status
        }
      },
      'OUTCOME_UNKNOWN'
    ],
    [
      'running without bound launch',
      ({ task }) => {
        task.status = 'running'
        for (const event of task.events) {
          event.status = task.status
        }
      },
      'OUTCOME_UNKNOWN'
    ],
    [
      'missing binding',
      ({ task }) => {
        delete task.structuredBinding
      },
      'IDEMPOTENCY_CONFLICT'
    ],
    [
      'missing Session',
      ({ state, binding }) => {
        state.records.delete(binding.sessionId)
      },
      'OUTCOME_UNKNOWN'
    ],
    [
      'missing source',
      ({ record }) => {
        delete record.taskSource
      },
      'IDEMPOTENCY_CONFLICT'
    ],
    [
      'undefined source',
      ({ record }) => {
        Object.assign(record, { taskSource: undefined })
      },
      'INVALID_REQUEST'
    ],
    [
      'foreign source',
      ({ record }) => {
        if (!record.taskSource) {
          throw new Error('Missing test source')
        }
        record.taskSource.executionEpoch += 1
      },
      'IDEMPOTENCY_CONFLICT'
    ],
    [
      'foreign provider',
      ({ record }) => {
        record.provider = 'claude'
        record.accountHome = { variable: 'CLAUDE_CONFIG_DIR', path: '/synthetic/foreign-home' }
        for (const link of record.providerHandleChain) {
          link.handle = { provider: 'claude', sessionId: 'foreign-provider', leafUuid: null }
        }
      },
      'IDEMPOTENCY_CONFLICT'
    ],
    [
      'home',
      ({ record }) => {
        record.accountHome.path += '-foreign'
      },
      'IDEMPOTENCY_CONFLICT'
    ],
    [
      'home variable',
      ({ record }) => {
        record.accountHome.variable = 'CLAUDE_CONFIG_DIR'
      },
      'IDEMPOTENCY_CONFLICT'
    ],
    [
      'execution host',
      ({ record }) => {
        record.location.executionHostId = 'ssh:foreign-host'
      },
      'IDEMPOTENCY_CONFLICT'
    ],
    [
      'WSL location',
      ({ record }) => {
        record.location.wslDistro = 'Ubuntu'
      },
      'IDEMPOTENCY_CONFLICT'
    ],
    [
      'workspace',
      ({ record }) => {
        record.location.workspaceId += '-foreign'
      },
      'IDEMPOTENCY_CONFLICT'
    ],
    [
      'workspace kind',
      ({ record }) => {
        record.location.workspaceKind = 'git-worktree'
      },
      'IDEMPOTENCY_CONFLICT'
    ],
    [
      'session',
      ({ record }) => {
        record.sessionId = 'foreign_session'
        record.lease.sessionId = record.sessionId
      },
      'IDEMPOTENCY_CONFLICT'
    ],
    [
      'local host identity',
      ({ state }) => {
        state.hostId = 'ssh:foreign-host'
      },
      'IDEMPOTENCY_CONFLICT'
    ],
    [
      'runtime kind',
      ({ record }) => {
        Object.assign(record.lease, { runtimeKind: 'tui' })
      },
      'IDEMPOTENCY_CONFLICT'
    ],
    [
      'lease Session',
      ({ record }) => {
        record.lease.sessionId = 'foreign_session'
      },
      'INVALID_REQUEST'
    ],
    [
      'fence',
      ({ record }) => {
        record.lease.runtimeFence += 1
        for (const link of record.providerHandleChain) {
          link.mintedAtFence += 1
        }
      },
      'IDEMPOTENCY_CONFLICT'
    ],
    [
      'reserved spawn token',
      ({ record }) => {
        record.lease.reservedSpawnToken = 'foreign-spawn'
      },
      'IDEMPOTENCY_CONFLICT'
    ],
    [
      'owner spawn token',
      ({ record }) => {
        if (!record.lease.ownerProcess) {
          throw new Error('Missing test owner')
        }
        record.lease.ownerProcess.spawnToken = 'foreign-spawn'
      },
      'IDEMPOTENCY_CONFLICT'
    ],
    [
      'owner host',
      ({ record }) => {
        if (!record.lease.ownerProcess) {
          throw new Error('Missing test owner')
        }
        record.lease.ownerProcess.hostId = 'ssh:foreign-host'
      },
      'IDEMPOTENCY_CONFLICT'
    ],
    [
      'reserved claim',
      ({ record }) => {
        record.lease.claimStatus = 'reserved'
        record.lease.handoffStage = 'new-owner-proving'
      },
      'OUTCOME_UNKNOWN'
    ],
    [
      'unproven owner',
      ({ record }) => {
        record.lease.claimStatus = 'reserved'
        record.lease.handoffStage = 'new-owner-proving'
        record.lease.provenHandleLinkId = null
        record.lease.ownerProcess = null
      },
      'OUTCOME_UNKNOWN'
    ],
    [
      'released owner',
      ({ record }) => {
        record.lease.claimStatus = 'released'
        record.lease.ownerProcess = null
      },
      'OUTCOME_UNKNOWN'
    ],
    [
      'conflicted owner',
      ({ record }) => {
        record.lease.claimStatus = 'conflicted'
      },
      'OUTCOME_UNKNOWN'
    ],
    [
      'unreconciled owner',
      ({ record }) => {
        record.lease.unreconciled = true
      },
      'OUTCOME_UNKNOWN'
    ],
    [
      'recovering owner',
      ({ record }) => {
        record.lease.handoffStage = 'recovering'
      },
      'OUTCOME_UNKNOWN'
    ],
    [
      'dead owner',
      ({ record }) => {
        record.lease.deathEvidence = {
          kind: 'exit-observed',
          detail: 'synthetic exit',
          observedAt: record.updatedAt,
          ownerFence: record.lease.runtimeFence
        }
      },
      'OUTCOME_UNKNOWN'
    ],
    [
      'unproved handle',
      ({ record }) => {
        record.lease.provenHandleLinkId = 'foreign-link'
      },
      'INVALID_REQUEST'
    ],
    [
      'stale handle fence',
      ({ record }) => {
        for (const link of record.providerHandleChain) {
          link.mintedAtFence += 1
        }
      },
      'INVALID_REQUEST'
    ]
  ]
  it.each(mutations)('rejects %s without mutating the original state', (_label, mutate, code) => {
    const fixture = taskModelDispatchFixture()
    mutate(fixture)
    const before = structuredClone(fixture.state)
    expect(() => reserveTaskModelDispatch(fixture.state, fixture.task, fixture.binding)).toThrow(
      code
    )
    expect(fixture.state).toEqual(before)
    expect(Object.hasOwn(fixture.task, 'modelDispatchAttempts')).toBe(false)
  })
})
