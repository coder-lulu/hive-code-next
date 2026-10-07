import type { AgentSessionStoreTransactions } from '../runtime/agent-session-store-transactions'
import type { AgentSessionStoreState } from '../runtime/agent-session-store-contract'
import {
  TaskExecutionRecordSchema,
  taskExecutionRecordKey,
  taskExecutionIdentity,
  type TaskExecutionRecord
} from './task-execution-record'
import { refuseTaskExecution } from './task-execution-error'
export function updateTaskExecutionRecord(
  transactions: AgentSessionStoreTransactions,
  identity: Parameters<typeof taskExecutionRecordKey>[0],
  apply: (
    record: TaskExecutionRecord,
    now: number,
    state: AgentSessionStoreState
  ) => TaskExecutionRecord | null,
  now: number | (() => number),
  validate?: () => void,
  summary?: string
) {
  return transactions.transact((draft) => {
    validate?.()
    const key = taskExecutionRecordKey(identity)
    const current = draft.taskExecutions?.get(key)
    if (!current) {
      return refuseTaskExecution('EXECUTION_NOT_FOUND')
    }
    const recordedAt = typeof now === 'function' ? now() : now
    const next = apply(current, recordedAt, draft)
    if (!next) {
      return { changed: false, record: structuredClone(current) }
    }
    const statusChanged = next.status !== current.status || summary !== undefined
    const events = statusChanged
      ? [
          ...current.events,
          {
            ...taskExecutionIdentity(current.command),
            commandFingerprint: current.commandFingerprint,
            recordedAt: new Date(recordedAt).toISOString(),
            kind: 'execution.event' as const,
            eventId: `event:${current.commandFingerprint}:${current.events.length + 1}`,
            sequence: current.events.length + 1,
            status: next.status,
            ...(summary ? { summary } : {}),
            artifactRefs: next.result?.artifactRefs ?? []
          }
        ]
      : current.events
    const record = TaskExecutionRecordSchema.parse({
      ...next,
      revision: current.revision + 1,
      events
    })
    draft.taskExecutions!.set(key, record)
    return { changed: true, record: structuredClone(record) }
  })
}
