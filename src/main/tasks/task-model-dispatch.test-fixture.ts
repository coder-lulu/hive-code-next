import { resolve } from 'node:path'
import { canonicalAgentSessionDigest } from '../../shared/agent-session-mutation-envelope'
import { pendingAgentSessionOperationRow } from '../../shared/agent-session-operation-ledger'
import type { AgentLaunchResult } from '../../shared/agent-launch-intent'
import type { TaskStructuredBinding } from '../../shared/task-execution/task-structured-binding'
import {
  commitAgentSessionProcessIdentity,
  proveAgentSessionOwner
} from '../runtime/agent-session-lease-transitions'
import { openTestAgentSessionRecordStore } from '../runtime/agent-session-record-store-test-harness'
import { commitAgentSessionReservation } from '../runtime/agent-session-reservation-admission'
import {
  TaskExecutionRecordSchema,
  taskExecutionIdentity,
  type TaskExecutionWorkspace
} from './task-execution-record'
import { taskWorkspace, TASK_TEST_NOW } from './task-execution.test-fixture'
import { taskStructuredFixture } from './task-structured-reservation.test-fixture'

export const TASK_MODEL_DISPATCH_LOGS = 'logs/paperclip-development/p3/model-pre-debit/writer'

type Options = {
  sessionId?: string
  codexHome?: string
  workspace?: TaskExecutionWorkspace
  bound?: boolean
}

function preparedFixture(directory: string, options: Options) {
  const fixture = taskStructuredFixture(options.workspace ?? taskWorkspace(directory))
  fixture.request.sessionId = options.sessionId ?? 'codex_fixture_session'
  fixture.request.accountHome = {
    variable: 'CODEX_HOME',
    path: options.codexHome ?? resolve(directory, 'fake-home')
  }
  fixture.request.operation.fingerprint = canonicalAgentSessionDigest({
    method: 'agentSession.attach',
    sessionId: fixture.request.sessionId
  })
  const inner = pendingAgentSessionOperationRow({
    ...fixture.request.operation,
    now: TASK_TEST_NOW
  })
  const spawnToken = fixture.request.spawnToken
  if (typeof spawnToken !== 'string') {
    throw new Error('Synthetic reservation requires its original spawn token')
  }
  const process = {
    hostId: 'local',
    pid: 4242,
    processStartTimeMs: TASK_TEST_NOW - 1000,
    spawnToken
  }
  const link = {
    linkId: 'model-fixture-link',
    handle: { provider: 'codex' as const, threadId: 'model-fixture-thread' },
    origin: 'created' as const,
    mintedAtFence: 1,
    observedAt: TASK_TEST_NOW
  }
  const launch: AgentLaunchResult = {
    worktreeId: fixture.request.location.workspaceId,
    outcome: {
      kind: 'structured',
      sessionId: fixture.request.sessionId,
      handle: 'agent_model_test'
    },
    receipt: {
      mode: 'structured',
      preferred: 'structured',
      reason: 'user_default',
      detail: 'Synthetic owner proof fixture.'
    }
  }
  return { ...fixture, inner, process, link, launch }
}

export function taskModelDispatchFixture(options: Options = {}) {
  const fixture = preparedFixture(resolve(TASK_MODEL_DISPATCH_LOGS, 'pure'), options)
  const reserved = commitAgentSessionReservation(fixture.state, fixture.request, 30_000).record
  const observed = commitAgentSessionProcessIdentity({
    record: reserved,
    sessionId: reserved.sessionId,
    fence: reserved.lease.runtimeFence,
    process: fixture.process,
    now: TASK_TEST_NOW
  })
  const record = proveAgentSessionOwner({
    record: observed,
    fence: observed.lease.runtimeFence,
    link: fixture.link,
    now: TASK_TEST_NOW,
    leaseTtlMs: 30_000
  })
  fixture.state.records.set(record.sessionId, record)
  let task = fixture.state.taskExecutions?.get(fixture.key)
  if (!task?.structuredBinding) {
    throw new Error('Original reservation did not bind the Task')
  }
  if (options.bound) {
    task = TaskExecutionRecordSchema.parse({
      ...task,
      revision: task.revision + 1,
      status: 'running',
      dispatch: 'bound',
      launch: fixture.launch,
      events: [
        ...task.events,
        {
          ...taskExecutionIdentity(task.command),
          commandFingerprint: task.commandFingerprint,
          recordedAt: new Date(TASK_TEST_NOW).toISOString(),
          kind: 'execution.event',
          eventId: 'event:model-fixture-running',
          sequence: task.events.length + 1,
          status: 'running',
          artifactRefs: []
        }
      ]
    })
    fixture.state.taskExecutions?.set(fixture.key, task)
  }
  if (!task.structuredBinding) {
    throw new Error('Original Task lost its binding')
  }
  const binding: TaskStructuredBinding = structuredClone(task.structuredBinding)
  fixture.validate.mockClear()
  return { ...fixture, task, binding, record }
}

/** The caller owns directory creation and cleanup; all proof is synthetic. */
export async function createTaskModelDispatchFixture(directory: string, options: Options = {}) {
  const fixture = preparedFixture(directory, options)
  const store = await openTestAgentSessionRecordStore(directory)
  await store.tasks.admit(fixture.admission)
  await store.tasks.beginDispatch(fixture.command, TASK_TEST_NOW, fixture.validate)
  await store.admitOperation({ ...fixture.outer, now: TASK_TEST_NOW })
  const claim = await store.claimOperation(fixture.outer)
  if (claim.claim !== 'won') {
    throw new Error('Original outer operation was not claimed')
  }
  const reserved = await store.reserveOwner(fixture.request)
  await store.commitProcessIdentity({
    sessionId: reserved.record.sessionId,
    fence: reserved.record.lease.runtimeFence,
    process: fixture.process,
    now: TASK_TEST_NOW
  })
  const record = await store.proveOwner({
    sessionId: reserved.record.sessionId,
    fence: reserved.record.lease.runtimeFence,
    link: fixture.link,
    now: TASK_TEST_NOW
  })
  if (options.bound) {
    await store.tasks.bindLaunch(fixture.command, fixture.launch, TASK_TEST_NOW)
  }
  const task = store.tasks.get(fixture.command)
  if (!task?.structuredBinding) {
    throw new Error('Original reservation did not persist the Task binding')
  }
  const binding = structuredClone(task.structuredBinding)
  fixture.validate.mockClear()
  const reserve = (validate: () => void = fixture.validate) =>
    store.tasks.reserveModelDispatch(binding, TASK_TEST_NOW, validate)
  return { ...fixture, store, task, binding, record, reserve }
}
