import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openTestAgentSessionRecordStore } from '../runtime/agent-session-record-store-test-harness'
import { closeTestJournalHostDatabase } from '../native-chat/agent-session-journal/journal-host-database-test-support'
import { taskExecutionIdentity, type TaskExecutionRecord } from './task-execution-record'
import {
  taskCommand,
  taskWorkspace,
  taskTestDirectory,
  TASK_TEST_CALLER,
  TASK_TEST_NOW
} from './task-execution.test-fixture'

let directory: string | undefined
afterEach(async () => {
  if (directory) {
    closeTestJournalHostDatabase(directory)
    await rm(directory, { recursive: true, force: true })
  }
})
function terminalResult(record: TaskExecutionRecord) {
  const recordedAt = new Date(TASK_TEST_NOW).toISOString()
  return {
    ...taskExecutionIdentity(record.command),
    commandFingerprint: record.commandFingerprint,
    recordedAt,
    kind: 'execution.result' as const,
    status: 'failed' as const,
    receiptId: `result:${randomUUID()}`,
    outcomeRef: 'outcome:test',
    artifactRefs: [],
    usageFactRefs: [],
    stopProof: {
      proofRef: `proof:${randomUUID()}`,
      evidenceKind: 'not_started' as const,
      managedToolsSettled: true as const,
      writersFenced: true as const,
      recordedAt
    }
  }
}

describe('terminal task settlement replay through the host store writer', () => {
  it('does not generate conflicting receipts for competing terminal settlement factories', async () => {
    directory = await taskTestDirectory()
    const store = await openTestAgentSessionRecordStore(directory)
    const command = taskCommand()
    const { record } = await store.tasks.admit({
      command,
      ...TASK_TEST_CALLER,
      workspace: taskWorkspace(directory),
      now: TASK_TEST_NOW,
      validate: () => undefined
    })
    const factory = vi.fn(terminalResult)
    const results = await Promise.all([
      store.tasks.settle(command, factory, TASK_TEST_NOW),
      store.tasks.settle(command, factory, TASK_TEST_NOW)
    ])
    expect(factory).toHaveBeenCalledTimes(1)
    expect(results[0].record.result).toEqual(results[1].record.result)
    await expect(
      store.tasks.settle(command, terminalResult(record), TASK_TEST_NOW)
    ).rejects.toThrow('IDEMPOTENCY_CONFLICT')
    closeTestJournalHostDatabase(directory)
    const reopened = await openTestAgentSessionRecordStore(directory)
    const replayFactory = vi.fn(terminalResult)
    const replay = await reopened.tasks.settle(command, replayFactory, TASK_TEST_NOW)
    expect(replayFactory).not.toHaveBeenCalled()
    expect(replay.changed).toBe(false)
    expect(replay.record.result).toEqual(results[0].record.result)
  })
})
