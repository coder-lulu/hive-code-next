import { randomUUID } from 'node:crypto'
import { taskExecutionIdentity, type TaskExecutionRecord } from './task-execution-record'

export function taskCancelledResult(
  record: TaskExecutionRecord,
  evidenceKind: 'not_started' | 'stopped',
  now: number
) {
  const recordedAt = new Date(now).toISOString()
  return {
    ...taskExecutionIdentity(record.command),
    commandFingerprint: record.commandFingerprint,
    recordedAt,
    kind: 'execution.result' as const,
    receiptId: `result:${randomUUID()}`,
    outcomeRef: `cancel:${randomUUID()}`,
    artifactRefs: [],
    usageFactRefs: [],
    status: 'cancelled' as const,
    stopProof: {
      proofRef: `stop:${randomUUID()}`,
      evidenceKind,
      managedToolsSettled: true as const,
      writersFenced: true as const,
      recordedAt
    }
  }
}
