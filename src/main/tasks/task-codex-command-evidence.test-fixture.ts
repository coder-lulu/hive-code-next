import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { vi } from 'vitest'
import type {
  AgentJournalRenderItem,
  AgentJournalSnapshot
} from '../../shared/agent-session-journal-types'
import {
  agentJournalItemKey,
  agentJournalSubmissionKey
} from '../../shared/agent-session-journal-item-key'
import type { AgentSessionRecord } from '../../shared/agent-session-record'
import { taskSessionSourceReference } from '../../shared/task-execution/task-structured-binding'
import { codexItemBody } from '../codex/codex-structured-item-translation'
import { codexTurnLifecycleIdentity } from '../codex/codex-structured-journal-translation-turns'
import { openTestAgentSessionRecordStore } from '../runtime/agent-session-record-store-test-harness'
import {
  taskCommand,
  taskWorkspace,
  TASK_TEST_CALLER,
  TASK_TEST_NOW
} from './task-execution.test-fixture'
import { taskExecutionIdentity } from './task-execution-record'
import { taskResultManifestName } from './task-artifact-index'

export const COMMAND_SESSION = 'session-command-evidence'
export const COMMAND_THREAD = 'thread-command-evidence'
export const COMMAND_TURN = 'turn-command-evidence'
export const COMMAND_PROMPT = 'message-command-evidence'
export const commandTurnItemId = agentJournalItemKey(
  codexTurnLifecycleIdentity(COMMAND_SESSION, COMMAND_TURN)
)

export function commandTurn(): AgentJournalRenderItem {
  return {
    itemId: commandTurnItemId,
    revision: 1,
    sequence: 2,
    observedAt: TASK_TEST_NOW,
    turnScope: { kind: 'thread' },
    body: {
      kind: 'turn',
      turnId: COMMAND_TURN,
      state: 'completed',
      outcome: 'success',
      userItemId: agentJournalSubmissionKey(COMMAND_PROMPT),
      startedAt: TASK_TEST_NOW,
      completedAt: TASK_TEST_NOW + 1
    }
  }
}

export function commandEntry(
  id = 'command-1',
  fields: Record<string, unknown> = {},
  attribution: Partial<AgentJournalRenderItem> = {}
): AgentJournalRenderItem {
  const body = codexItemBody({
    type: 'commandExecution',
    id,
    command: 'pnpm test',
    cwd: '/workspace',
    status: 'completed',
    exitCode: 0,
    aggregatedOutput: 'one test passed',
    ...fields
  })
  if (!body) {
    throw new Error('Missing command fixture body')
  }
  return {
    itemId: agentJournalItemKey({
      provider: 'orca',
      clientMessageId: `codex-item:${COMMAND_THREAD}:${id}`
    }),
    revision: 2,
    sequence: 3,
    observedAt: TASK_TEST_NOW,
    turnScope: { kind: 'turn', turnItemId: commandTurnItemId },
    body,
    ...attribution
  }
}

export async function commandEvidenceFixture(status: 'succeeded' | 'failed' = 'succeeded') {
  const parent = resolve('logs/paperclip-development/p3/case-outcomes/command-evidence/tmp')
  await mkdir(parent, { recursive: true })
  const root = await mkdtemp(join(parent, 'command-'))
  const store = await openTestAgentSessionRecordStore(root)
  const command = taskCommand()
  const admitted = await store.tasks.admit({
    command,
    workspace: taskWorkspace(root),
    operationCallerKey: TASK_TEST_CALLER.operationCallerKey,
    now: TASK_TEST_NOW,
    validate: () => undefined
  })
  await mkdir(admitted.record.workspace.executionPath)
  await store.tasks.beginDispatch(command, TASK_TEST_NOW, () => undefined)
  await store.tasks.bindLaunch(
    command,
    {
      worktreeId: admitted.record.workspace.workspaceId,
      outcome: { kind: 'structured', sessionId: COMMAND_SESSION, handle: 'worker:command' },
      receipt: {
        mode: 'structured',
        preferred: 'structured',
        reason: 'user_default',
        detail: 'Fixture only.'
      },
      prompt: { delivery: 'submit', outcome: 'journaled', messageId: COMMAND_PROMPT }
    },
    TASK_TEST_NOW
  )
  const beforeStop = store.tasks.get(command)
  if (!beforeStop) {
    throw new Error('Missing fixture record')
  }
  const settled = await store.tasks.settle(
    command,
    {
      ...taskExecutionIdentity(command),
      kind: 'execution.result',
      commandFingerprint: admitted.record.commandFingerprint,
      receiptId: 'result:command-fixture',
      recordedAt: new Date(TASK_TEST_NOW).toISOString(),
      outcomeRef: 'outcome:command-fixture',
      status,
      artifactRefs: [],
      usageFactRefs: [],
      stopProof: {
        proofRef: 'stop:synthetic-host-fixture',
        evidenceKind: 'stopped',
        managedToolsSettled: true,
        writersFenced: true,
        recordedAt: new Date(TASK_TEST_NOW).toISOString()
      }
    },
    TASK_TEST_NOW
  )
  const record = settled.record
  const session: Pick<
    AgentSessionRecord,
    'sessionId' | 'provider' | 'location' | 'providerHandleChain' | 'taskSource'
  > = {
    sessionId: COMMAND_SESSION,
    provider: 'codex',
    location: {
      executionHostId: 'local',
      wslDistro: null,
      workspaceId: record.workspace.workspaceId,
      workspaceKind: 'folder'
    },
    providerHandleChain: [
      {
        linkId: 'command-link',
        handle: { provider: 'codex', threadId: COMMAND_THREAD },
        origin: 'created',
        mintedAtFence: 1,
        observedAt: TASK_TEST_NOW
      }
    ],
    taskSource: taskSessionSourceReference(record)
  }
  const snapshot: AgentJournalSnapshot = {
    sessionId: COMMAND_SESSION,
    cursor: { epoch: 'journal-command-epoch', sequence: 3 },
    submissions: [
      {
        clientMessageId: COMMAND_PROMPT,
        fence: 1,
        payloadFingerprint: 'a'.repeat(64),
        dispatchState: 'accepted',
        reason: null,
        providerItemId: agentJournalItemKey({
          provider: 'codex',
          threadId: COMMAND_THREAD,
          turnId: COMMAND_TURN,
          ordinal: 0
        }),
        submittedAt: TASK_TEST_NOW,
        resolvedAt: TASK_TEST_NOW
      }
    ],
    items: [commandTurn(), commandEntry()]
  }
  const host = {
    deps: { store: { getRecord: vi.fn(() => session) } },
    flushStreamedEvents: vi.fn(async () => undefined),
    journalSnapshot: vi.fn(async () => snapshot)
  }
  await writeFile(
    join(record.workspace.executionPath, taskResultManifestName(record.commandFingerprint)),
    JSON.stringify({
      schemaVersion: 1,
      executionId: record.command.executionId,
      commandFingerprint: record.commandFingerprint,
      status,
      artifacts: []
    })
  )
  return {
    root,
    store,
    record,
    beforeStop,
    session,
    snapshot,
    host,
    artifacts: join(root, 'artifacts')
  }
}
