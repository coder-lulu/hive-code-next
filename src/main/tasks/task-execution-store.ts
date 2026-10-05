import { canonicalAgentSessionDigest } from '../../shared/agent-session-mutation-envelope'
import type { AgentLaunchResult } from '../../shared/agent-launch-intent'
import {
  TaskExecutionResultSchema,
  type TaskExecutionResult
} from '../../shared/task-execution/task-execution-receipts'
import type { AgentSessionStoreTransactions } from '../runtime/agent-session-store-transactions'
import { admitTaskExecution, type TaskExecutionAdmission } from './task-execution-admission'
import { refuseTaskExecution } from './task-execution-error'
import {
  TaskExecutionRecordSchema,
  taskExecutionIdentity,
  taskExecutionRecordKey,
  type TaskExecutionRecord
} from './task-execution-record'

type Identity = Parameters<typeof taskExecutionRecordKey>[0]

/** Business bindings share the runtime's single writer; launch deduplication stays in its ledger. */
export class TaskExecutionPersistence {
  constructor(private readonly transactions: AgentSessionStoreTransactions) {}

  get(identity: Identity): TaskExecutionRecord | null {
    return structuredClone(
      this.transactions.state.taskExecutions?.get(taskExecutionRecordKey(identity)) ?? null
    )
  }

  admit(input: TaskExecutionAdmission) {
    return this.transactions.transact((draft) => admitTaskExecution(draft, input))
  }

  async beginDispatch(identity: Identity, now: number, validate: () => void) {
    return this.update(
      identity,
      (record) => {
        validate()
        if (this.transactions.state.taskRecoveryBlocked) {
          return refuseTaskExecution('OUTCOME_UNKNOWN')
        }
        if (
          record.status !== 'accepted' ||
          record.result ||
          record.cancellationKey ||
          record.dispatch !== 'not_dispatched'
        ) {
          return null
        }
        return { ...record, dispatch: 'dispatching' }
      },
      now
    )
  }

  bindLaunch(identity: Identity, launch: AgentLaunchResult, now: number) {
    return this.update(
      identity,
      (record) => {
        if (record.dispatch === 'bound') {
          if (!record.launch) {
            return refuseTaskExecution('OUTCOME_UNKNOWN')
          }
          if (canonicalAgentSessionDigest(record.launch) !== canonicalAgentSessionDigest(launch)) {
            return refuseTaskExecution('IDEMPOTENCY_CONFLICT')
          }
          return null
        }
        if (
          record.dispatch !== 'dispatching' ||
          record.result ||
          launch.worktreeId !== record.workspace.workspaceId
        ) {
          return refuseTaskExecution('OUTCOME_UNKNOWN')
        }
        return {
          ...record,
          dispatch: 'bound',
          launch,
          status: record.cancellationKey ? 'cancel_requested' : 'running'
        }
      },
      now
    )
  }

  requestCancellation(
    identity: Identity,
    cancellationKey: string,
    now: number,
    validate: () => void
  ) {
    return this.update(
      identity,
      (record) => {
        validate()
        if (record.result || record.cancellationKey) {
          return null
        }
        return { ...record, cancellationKey, status: 'cancel_requested' }
      },
      now
    )
  }

  markUnknown(identity: Identity, now: number) {
    return this.update(
      identity,
      (record) =>
        record.result || record.status === 'outcome_unknown'
          ? null
          : { ...record, status: 'outcome_unknown' },
      now
    )
  }

  settle(
    identity: Identity,
    resultValue: TaskExecutionResult | ((record: TaskExecutionRecord) => TaskExecutionResult),
    now: number
  ) {
    return this.update(
      identity,
      (record) => {
        // A competing collector may have settled while this transaction waited for the lock.
        if (record.result && typeof resultValue === 'function') {
          return null
        }
        const result = TaskExecutionResultSchema.parse(
          typeof resultValue === 'function' ? resultValue(structuredClone(record)) : resultValue
        )
        if (record.result) {
          if (canonicalAgentSessionDigest(result) !== canonicalAgentSessionDigest(record.result)) {
            return refuseTaskExecution('IDEMPOTENCY_CONFLICT')
          }
          return null
        }
        if (
          (result.stopProof.evidenceKind === 'not_started' &&
            record.dispatch !== 'not_dispatched') ||
          (result.status === 'succeeded' &&
            (record.dispatch !== 'bound' || record.cancellationKey !== null)) ||
          (result.status === 'cancelled' && record.cancellationKey === null)
        ) {
          return refuseTaskExecution('OUTCOME_UNKNOWN')
        }
        return { ...record, result, status: result.status }
      },
      now
    )
  }

  private update(
    identity: Identity,
    apply: (record: TaskExecutionRecord) => TaskExecutionRecord | null,
    now: number
  ) {
    return this.transactions.transact((draft) => {
      const key = taskExecutionRecordKey(identity)
      const current = draft.taskExecutions?.get(key)
      if (!current) {
        return refuseTaskExecution('EXECUTION_NOT_FOUND')
      }
      const next = apply(current)
      if (!next) {
        return { changed: false, record: structuredClone(current) }
      }
      const statusChanged = next.status !== current.status
      const events = statusChanged
        ? [
            ...current.events,
            {
              ...taskExecutionIdentity(current.command),
              commandFingerprint: current.commandFingerprint,
              recordedAt: new Date(now).toISOString(),
              kind: 'execution.event' as const,
              eventId: `event:${current.commandFingerprint}:${current.events.length + 1}`,
              sequence: current.events.length + 1,
              status: next.status,
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
}
