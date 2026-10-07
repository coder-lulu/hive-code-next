import { describe, expect, it } from 'vitest'
import { TaskExecutionRecordSchema } from './task-execution-record'
import { taskStructuredFixture } from './task-structured-reservation.test-fixture'
import { commitAgentSessionReservation } from '../runtime/agent-session-reservation-admission'
import { emptyState } from '../runtime/agent-session-store-parsing'
import {
  loadHiveRuntimeState,
  serializeHiveRuntimeState,
  writeHiveRuntimeState
} from '../runtime/agent-session-hive-state-rows'
import Database from '../sqlite/sync-database'
import {
  TaskSessionSourceReferenceSchema,
  TaskStructuredBindingSchema,
  taskSessionSourceReference
} from '../../shared/task-execution/task-structured-binding'
import { TASK_TEST_LAUNCH } from './task-execution.test-fixture'

function boundFixture() {
  const fixture = taskStructuredFixture()
  commitAgentSessionReservation(fixture.state, fixture.request, 30_000)
  const task = fixture.state.taskExecutions!.get(fixture.key)!
  return { ...fixture, task, binding: task.structuredBinding! }
}

function coldTask(state: ReturnType<typeof boundFixture>['state'], key: string, malformed = false) {
  const db = new Database(':memory:')
  try {
    db.exec('CREATE TABLE agent_session_store_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    const json = malformed
      ? JSON.stringify({
          hostId: state.hostId,
          hiveSessions: {},
          taskExecutions: Object.fromEntries(state.taskExecutions ?? [])
        })
      : serializeHiveRuntimeState(state)
    writeHiveRuntimeState(db, json)
    const loaded = emptyState('local')
    loadHiveRuntimeState(db, loaded)
    return loaded.taskExecutions?.get(key)
  } finally {
    db.close()
  }
}

describe('task session source and structured binding data', () => {
  it('derives only the original task identity and fingerprint', () => {
    const { task } = taskStructuredFixture()
    expect(task.command.agent).toBe('hivecode')
    expect(taskSessionSourceReference(task)).toEqual({
      kind: 'task_execution',
      runtimeRecordId: task.command.runtimeRecordId,
      ownershipEpoch: task.command.ownershipEpoch,
      executionId: task.command.executionId,
      executionEpoch: task.command.executionEpoch,
      commandFingerprint: task.commandFingerprint
    })
  })
  it.each([
    { kind: 'personal' },
    { ownershipEpoch: 0 },
    { executionEpoch: 0 },
    { runtimeRecordId: '' },
    { commandFingerprint: 'a'.repeat(63) },
    { authorize: true }
  ])('rejects malformed or extra source fields %j', (patch) => {
    const { origin } = taskStructuredFixture()
    expect(TaskSessionSourceReferenceSchema.safeParse({ ...origin.source, ...patch }).success).toBe(
      false
    )
  })
  it.each([
    { extra: true },
    { runtimeFence: 0 },
    { spawnToken: '' },
    { sessionId: 'session-task-one\n' },
    { launchFingerprint: 'bad' },
    { attachOperationId: 'not-operation' },
    { attachFingerprint: 'bad' },
    { accountHome: { variable: 'CLAUDE_CONFIG_DIR', path: '/wrong' } },
    { accountHome: { variable: 'CODEX_HOME', path: '' } },
    { accountHome: { variable: 'CODEX_HOME', path: 'a'.repeat(4097) } },
    { accountHome: { variable: 'CODEX_HOME', path: '/home', credential: 'forged' } },
    {
      location: {
        executionHostId: 'remote',
        wslDistro: null,
        workspaceId: 'workspace',
        workspaceKind: 'folder'
      }
    },
    {
      location: {
        executionHostId: 'local',
        wslDistro: 'Ubuntu',
        workspaceId: 'workspace',
        workspaceKind: 'folder'
      }
    }
  ])('strictly rejects malformed structured binding %j', (patch) => {
    expect(
      TaskStructuredBindingSchema.safeParse({ ...boundFixture().binding, ...patch }).success
    ).toBe(false)
  })
  it.each([
    (binding: ReturnType<typeof boundFixture>['binding']) => ({
      ...binding,
      source: { ...binding.source, ownershipEpoch: binding.source.ownershipEpoch + 1 }
    }),
    (binding: ReturnType<typeof boundFixture>['binding']) => ({
      ...binding,
      source: { ...binding.source, commandFingerprint: 'c'.repeat(64) }
    }),
    (binding: ReturnType<typeof boundFixture>['binding']) => ({
      ...binding,
      operationCallerKey: 'caller:another'
    }),
    (binding: ReturnType<typeof boundFixture>['binding']) => ({
      ...binding,
      operationId: `1800000000000-${'c'.repeat(32)}`
    }),
    (binding: ReturnType<typeof boundFixture>['binding']) => ({
      ...binding,
      attachOperationId: `1800000000000-${'d'.repeat(32)}`
    }),
    (binding: ReturnType<typeof boundFixture>['binding']) => ({
      ...binding,
      location: { ...binding.location, workspaceId: 'workspace:another' }
    }),
    (binding: ReturnType<typeof boundFixture>['binding']) => ({
      ...binding,
      location: { ...binding.location, workspaceKind: 'git-worktree' as const }
    })
  ])('rejects a binding detached from the original durable task', (patch) => {
    const { task, binding } = boundFixture()
    expect(
      TaskExecutionRecordSchema.safeParse({ ...task, structuredBinding: patch(binding) }).success
    ).toBe(false)
  })
  it('checks structured launch identity once the original task has a result', () => {
    const { task, binding } = boundFixture()
    const launch = {
      worktreeId: task.workspace.workspaceId,
      outcome: { kind: 'structured' as const, sessionId: binding.sessionId, handle: 'chat-task' },
      receipt: {
        mode: 'structured' as const,
        preferred: 'structured' as const,
        reason: 'user_default' as const,
        detail: 'Test fixture.'
      }
    }
    const running = {
      ...task,
      launch,
      dispatch: 'bound',
      status: 'running',
      events: [
        ...task.events,
        { ...task.events[0], eventId: 'event:running', sequence: 2, status: 'running' }
      ]
    }
    expect(TaskExecutionRecordSchema.safeParse(running).success).toBe(true)
    for (const changed of [
      TASK_TEST_LAUNCH,
      { ...launch, worktreeId: 'wrong-workspace' },
      { ...launch, outcome: { ...launch.outcome, sessionId: 'session-task-fork' } }
    ]) {
      expect(TaskExecutionRecordSchema.safeParse({ ...running, launch: changed }).success).toBe(
        false
      )
    }
  })
  it('cold reads records missing the optional binding, and rejects malformed bindings', () => {
    const old = taskStructuredFixture()
    expect(TaskExecutionRecordSchema.safeParse(old.task).success).toBe(true)
    expect(coldTask(old.state, old.key)).toEqual(old.task)
    const { state, key, task } = boundFixture()
    expect(coldTask(state, key)).toEqual(task)
    state.taskExecutions!.set(key, Object.assign({}, task, { structuredBinding: { bad: true } }))
    expect(() => coldTask(state, key, true)).toThrow()
  })
})
