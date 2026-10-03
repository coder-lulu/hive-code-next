import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openTestAgentSessionRecordStore } from '../runtime/agent-session-record-store-test-harness'
import { agentJournalSubmissionKey } from '../../shared/agent-session-journal-item-key'
import { createTaskCodexEvidence } from './task-codex-evidence'
import { taskResultManifestName } from './task-artifact-index'
import {
  taskCommand,
  taskTestDirectory,
  taskWorkspace,
  TASK_TEST_CALLER,
  TASK_TEST_NOW
} from './task-execution.test-fixture'

const mocks = vi.hoisted(() => ({ host: vi.fn(), observe: vi.fn(), close: vi.fn() }))
vi.mock('../native-chat/agent-session-wire/structured-agent-session-registry', () => ({
  getStructuredAgentSessionHost: mocks.host
}))
vi.mock('../runtime/structured-worker-authority', () => ({
  observeStructuredWorker: mocks.observe
}))
vi.mock('../runtime/structured-agent-session-close', () => ({
  closeStructuredAgentSessionChild: mocks.close
}))
let directory = ''
afterEach(async () => {
  vi.resetAllMocks()
  if (directory) {
    await rm(directory, { recursive: true, force: true })
  }
})
async function fixture() {
  directory = await taskTestDirectory()
  const store = await openTestAgentSessionRecordStore(directory)
  const record = (
    await store.tasks.admit({
      command: taskCommand(),
      workspace: taskWorkspace(directory),
      operationCallerKey: TASK_TEST_CALLER.operationCallerKey,
      now: TASK_TEST_NOW,
      validate: () => undefined
    })
  ).record
  await mkdir(record.workspace.executionPath)
  record.dispatch = 'bound'
  record.launch = {
    worktreeId: record.workspace.workspaceId,
    outcome: { kind: 'structured', sessionId: 'session:test', handle: 'worker:test' },
    receipt: {
      mode: 'structured',
      preferred: 'structured',
      reason: 'user_default',
      detail: 'test'
    },
    prompt: { delivery: 'submit', outcome: 'journaled', messageId: 'message:test' }
  }
  const session = {
    provider: 'codex',
    location: { executionHostId: 'local', workspaceId: record.workspace.workspaceId }
  }
  const snapshot = {
    submissions: [
      {
        clientMessageId: 'message:test',
        dispatchState: 'accepted',
        providerItemId: 'provider:item'
      }
    ],
    items: [
      {
        body: {
          kind: 'turn',
          turnId: 'turn:test',
          state: 'completed',
          outcome: 'success',
          userItemId: agentJournalSubmissionKey('message:test')
        }
      }
    ]
  }
  mocks.host.mockReturnValue({
    deps: { store: { getRecord: () => session } },
    flushStreamedEvents: vi.fn(async () => undefined),
    journalSnapshot: vi.fn(async () => snapshot)
  })
  mocks.close.mockResolvedValue({ stopped: true, closeAttempted: true })
  mocks.observe.mockReturnValue({ status: 'exited' })
  await writeFile(
    join(record.workspace.executionPath, taskResultManifestName(record.commandFingerprint)),
    JSON.stringify({
      schemaVersion: 1,
      executionId: record.command.executionId,
      commandFingerprint: record.commandFingerprint,
      status: 'succeeded',
      artifacts: []
    })
  )
  return {
    record,
    session,
    snapshot,
    evidence: createTaskCodexEvidence(join(directory, 'artifacts'))
  }
}
describe('Codex task completion and stop evidence', () => {
  it('requires the accepted task prompt, provider verdict and no live tools before collecting', async () => {
    const f = await fixture()
    expect((await f.evidence.collect(f.record))?.status).toBe('succeeded')
    f.snapshot.submissions[0]!.dispatchState = 'pending'
    expect(await f.evidence.collect(f.record)).toBeNull()
    f.snapshot.submissions[0]!.dispatchState = 'accepted'
    f.snapshot.items[0]!.body.outcome = 'unverifiable'
    expect(await f.evidence.collect(f.record)).toBeNull()
    f.snapshot.items[0]!.body.outcome = 'success'
    f.snapshot.items[0]!.body.state = 'running'
    expect(await f.evidence.collect(f.record)).toBeNull()
  })
  it('refuses another provider or workspace even if a manifest claims success', async () => {
    const f = await fixture()
    f.session.provider = 'claude'
    await expect(f.evidence.collect(f.record)).rejects.toThrow('OUTCOME_UNKNOWN')
    f.session.provider = 'codex'
    f.session.location.workspaceId = 'foreign'
    await expect(f.evidence.collect(f.record)).rejects.toThrow('OUTCOME_UNKNOWN')
  })
  it('does not treat UI close or an unverifiable lease as process death', async () => {
    const f = await fixture()
    mocks.observe.mockReturnValue({ status: 'unverifiable' })
    expect(await f.evidence.stop(f.record)).toBeNull()
    mocks.observe.mockReturnValue({ status: 'live' })
    expect(await f.evidence.stop(f.record)).toBeNull()
    mocks.observe.mockReturnValue({ status: 'exited' })
    expect(await f.evidence.stop(f.record)).toMatchObject({
      evidenceKind: 'stopped',
      writersFenced: true
    })
  })
})
