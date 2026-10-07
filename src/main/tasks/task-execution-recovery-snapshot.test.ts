import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { closeTestJournalHostDatabases } from '../native-chat/agent-session-journal/journal-host-database-test-support'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computeTaskExecutionFingerprint } from '../../shared/task-execution/task-execution-fingerprint'
import {
  editPersistedTestAgentSessionStore,
  openTestAgentSessionRecordStore,
  readPersistedTestAgentSessionStore
} from '../runtime/agent-session-record-store-test-harness'
import type { AgentSessionRecordStore } from '../runtime/agent-session-record-store'
import { TaskExecutionHost } from './task-execution-host'
import {
  TaskExecutionRecordSchema,
  taskExecutionRecordKey,
  type TaskExecutionRecord
} from './task-execution-record'
import {
  taskCommand,
  taskCapabilities,
  taskWorkspace,
  TASK_TEST_CALLER,
  TASK_TEST_LAUNCH,
  TASK_TEST_NOW
} from './task-execution.test-fixture'

const evidenceRoot = resolve(
  'logs/paperclip-development/p3/task-startup-cancellation-proof/recovery-cas-writer/tmp'
)
const fingerprint = 'original-launch-fingerprint'
let directory: string
let store: AgentSessionRecordStore
let host: TaskExecutionHost | undefined
beforeEach(async () => {
  await mkdir(evidenceRoot, { recursive: true })
  directory = await mkdtemp(join(evidenceRoot, 'recovery-snapshot-'))
  store = await openTestAgentSessionRecordStore(directory)
})
afterEach(async () => {
  await host?.drain()
  host = undefined
  vi.restoreAllMocks()
  closeTestJournalHostDatabases()
  const child = relative(evidenceRoot, resolve(directory))
  if (!child || isAbsolute(child) || child === '..' || child.startsWith(`..${sep}`)) {
    throw new Error('Refused cleanup outside recovery test root')
  }
  await rm(directory, { recursive: true, force: true })
})

async function dispatched() {
  const command = taskCommand({ operationId: `${TASK_TEST_NOW}-${'a'.repeat(32)}` })
  await store.tasks.admit({
    command,
    ...TASK_TEST_CALLER,
    workspace: taskWorkspace(directory),
    now: TASK_TEST_NOW,
    validate: () => undefined
  })
  await store.tasks.beginDispatch(command, TASK_TEST_NOW, () => undefined)
  await store.tasks.markUnknown(command, TASK_TEST_NOW)
  await store.admitOperation({
    callerKey: TASK_TEST_CALLER.operationCallerKey,
    operationId: command.operationId,
    fingerprint,
    now: TASK_TEST_NOW
  })
  await store.recordOperationOutcome({
    callerKey: TASK_TEST_CALLER.operationCallerKey,
    operationId: command.operationId,
    outcome: { status: 'succeeded', sessionId: '', launch: TASK_TEST_LAUNCH }
  })
  return store.tasks.get(command)!
}

async function replace(original: TaskExecutionRecord, changed: string) {
  const command = {
    ...original.command,
    ownershipEpoch: original.command.ownershipEpoch + (changed === 'ownershipEpoch' ? 1 : 0)
  }
  const commandFingerprint = computeTaskExecutionFingerprint(command, original.operationCallerKey)
  const replacement = TaskExecutionRecordSchema.parse({
    ...original,
    command,
    commandFingerprint,
    workspace: {
      ...original.workspace,
      canonicalPath:
        changed === 'canonicalPath'
          ? join(directory, 'replacement')
          : original.workspace.canonicalPath
    },
    accepted: {
      ...original.accepted,
      ownershipEpoch: command.ownershipEpoch,
      commandFingerprint,
      receiptId: `accepted:${commandFingerprint}`
    },
    events: original.events.map((event) => ({
      ...event,
      ownershipEpoch: command.ownershipEpoch,
      commandFingerprint,
      eventId: `event:${commandFingerprint}:${event.sequence}`
    }))
  })
  expect(replacement).not.toEqual(original)
  const key = taskExecutionRecordKey(original.command)
  expect(taskExecutionRecordKey(replacement.command)).toBe(key)
  await editPersistedTestAgentSessionStore(directory, (persisted) => {
    persisted.taskExecutions[key] = replacement
  })
  return replacement
}

async function assertUnchanged(replacement: TaskExecutionRecord) {
  const persisted = await readPersistedTestAgentSessionStore(directory)
  const reopened = await openTestAgentSessionRecordStore(directory)
  const records = [
    store.tasks.get(replacement.command),
    persisted.taskExecutions[taskExecutionRecordKey(replacement.command)],
    reopened.tasks.get(replacement.command)
  ]
  // Returning a conflict cannot undo an earlier binding or cancellation write.
  expect(records).toEqual([replacement, replacement, replacement])
  expect(records.map((record) => record?.launch)).toEqual([null, null, null])
  expect(records.map((record) => record?.dispatch)).toEqual([
    'dispatching',
    'dispatching',
    'dispatching'
  ])
  expect(records.map((record) => record?.status)).toEqual([
    'outcome_unknown',
    'outcome_unknown',
    'outcome_unknown'
  ])
  expect(records.map((record) => record?.cancellationKey)).toEqual([null, null, null])
  expect(records.map((record) => record?.result)).toEqual([null, null, null])
}

function privateHost(command: TaskExecutionRecord['command']) {
  const launch = vi.fn(async () => TASK_TEST_LAUNCH)
  const collect = vi.fn(async () => null)
  const stop = vi.fn(async () => null)
  host = new TaskExecutionHost({
    store: store.tasks,
    capabilities: () => taskCapabilities(command),
    authorize: vi.fn(),
    launch,
    collect,
    stop,
    now: () => TASK_TEST_NOW
  })
  return { host, launch, collect, stop }
}

describe('original recovery preserves its immutable Task snapshot', () => {
  it.each(['ownershipEpoch', 'canonicalPath'])(
    'cannot bind the succeeded parent launch onto a valid %s replacement',
    async (changed) => {
      const original = await dispatched()
      const replacement = await replace(original, changed)
      const parentBefore = (await readPersistedTestAgentSessionStore(directory)).operations
      const error = await store.tasks
        .recoverLaunch(original, fingerprint, TASK_TEST_NOW, () => undefined)
        .then(
          () => null,
          (rejected: unknown) => rejected
        )
      await assertUnchanged(replacement)
      expect(error).toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' })
      expect((await readPersistedTestAgentSessionStore(directory)).operations).toEqual(parentBefore)
    }
  )

  it.each(['fenceRevokedExecution', 'recoverPersistedExecution'])(
    '%s cannot replace its caller-supplied snapshot with a refreshed workspace',
    async (action) => {
      const original = await dispatched()
      const ports = privateHost(original.command)
      const replacement = await replace(original, 'canonicalPath')
      await store.tasks.readActive(() => undefined)
      expect(store.tasks.get(original.command)).toEqual(replacement)
      const operation =
        action === 'fenceRevokedExecution'
          ? ports.host.fenceRevokedExecution(original, TASK_TEST_CALLER)
          : ports.host.recoverPersistedExecution(
              original,
              TASK_TEST_CALLER,
              fingerprint,
              () => undefined
            )
      const error = await operation.then(
        () => null,
        (rejected: unknown) => rejected
      )
      await assertUnchanged(replacement)
      expect(ports.collect).not.toHaveBeenCalled()
      expect(ports.stop).not.toHaveBeenCalled()
      expect(ports.launch).not.toHaveBeenCalled()
      expect(error).toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' })
    }
  )
})
