import type { AgentLaunchResult } from '../../shared/agent-launch-intent'
import { isAgentLaunchResult } from '../../shared/agent-launch-intent'
import { agentSessionOperationKey } from '../../shared/agent-session-operation-ledger'
import { canonicalAgentSessionDigest } from '../../shared/agent-session-mutation-envelope'
import {
  TaskStructuredBindingSchema,
  type TaskStructuredBinding
} from '../../shared/task-execution/task-structured-binding'
import {
  TaskExecutionResultSchema,
  type TaskExecutionResult
} from '../../shared/task-execution/task-execution-receipts'
import type { AgentSessionStoreTransactionQueue } from '../runtime/agent-session-store-transaction-queue'
import { admitTaskExecution, type TaskExecutionAdmission } from './task-execution-admission'
import { admitTaskDockerIdentity } from './task-docker-identity-admission'
import type { TaskDockerIdentity } from './task-docker-identity'
import { refuseTaskExecution } from './task-execution-error'
import {
  assertTaskModelDispatchCurrent,
  reserveTaskModelDispatch
} from './task-model-dispatch-reservation'
import { bindTaskLaunch } from './task-launch-binding'
import { settleCancelledTaskCodexDispatch } from './task-cancelled-dispatch'
import { assertTaskExecutionSnapshotCurrent } from './task-execution-snapshot-guard'
import { assertTaskCodexSessionBinding } from './task-codex-session-binding'
import { assertTaskAuthorizationCurrent } from './task-structured-launch-origin'
import { hasTaskSessionBinding } from './task-session-association'
import {
  TaskExecutionRecordSchema,
  taskExecutionIdentity,
  taskExecutionRecordKey,
  type TaskExecutionRecord
} from './task-execution-record'

type Identity = Parameters<typeof taskExecutionRecordKey>[0]

/** Business bindings share the runtime's single writer; launch deduplication stays in its ledger. */
export class TaskExecutionPersistence {
  constructor(private readonly transactions: AgentSessionStoreTransactionQueue) {}

  get(identity: Identity): TaskExecutionRecord | null {
    return this.transactions.readTaskExecution(taskExecutionRecordKey(identity))
  }

  hasSessionBinding(sessionId: string): boolean {
    return hasTaskSessionBinding(this.transactions.readState.taskExecutions, sessionId)
  }

  listActive(): TaskExecutionRecord[] {
    return this.transactions.readActiveTaskExecutions()
  }

  settleCancelledCodexDispatch(
    expected: TaskExecutionRecord,
    fingerprint: string,
    readNow: () => number,
    validate: () => void
  ) {
    return this.update(
      expected.command,
      (record, now) => {
        validate()
        assertTaskExecutionSnapshotCurrent(expected, record)
        return settleCancelledTaskCodexDispatch(
          this.transactions.state,
          record,
          fingerprint,
          now,
          expected
        )
      },
      readNow
    )
  }

  readActive(validate: () => void): Promise<TaskExecutionRecord[]> {
    return this.transactions.transact(() => {
      validate()
      return structuredClone(
        [...(this.transactions.state.taskExecutions?.values() ?? [])].filter(
          (record) => !record.result
        )
      )
    })
  }

  admit(input: TaskExecutionAdmission) {
    return this.transactions.transact(() => admitTaskExecution(this.transactions.state, input))
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
    return this.update(identity, (record) => bindTaskLaunch(record, launch), now)
  }

  async reserveModelDispatch(binding: TaskStructuredBinding, now: number, validate: () => void) {
    const snapshot = TaskStructuredBindingSchema.safeParse(binding)
    if (!snapshot.success) {
      return refuseTaskExecution('INVALID_REQUEST')
    }
    return this.update(
      snapshot.data.source,
      (record) => reserveTaskModelDispatch(this.transactions.state, record, snapshot.data),
      now,
      () => {
        if (typeof validate !== 'function') {
          return refuseTaskExecution('INVALID_REQUEST')
        }
        assertTaskAuthorizationCurrent(() => validate())
      }
    )
  }

  async runModelEffect<T>(binding: TaskStructuredBinding, validate: () => void, start: () => T) {
    const snapshot = TaskStructuredBindingSchema.safeParse(binding)
    if (!snapshot.success || typeof validate !== 'function' || typeof start !== 'function') {
      return refuseTaskExecution('INVALID_REQUEST')
    }
    return this.transactions.transact(() => {
      assertTaskAuthorizationCurrent(() => validate())
      const task = this.transactions.state.taskExecutions?.get(
        taskExecutionRecordKey(snapshot.data.source)
      )
      if (!task) {
        return refuseTaskExecution('EXECUTION_NOT_FOUND')
      }
      assertTaskModelDispatchCurrent(this.transactions.state, task, snapshot.data)
      if (!task.modelDispatchAttempts) {
        return refuseTaskExecution('OUTCOME_UNKNOWN')
      }
      // The envelope keeps the file transaction independent of a network promise.
      return { value: start() }
    })
  }

  assertStructuredBindingCurrent(binding: TaskStructuredBinding): void {
    const state = this.transactions.readState
    const task = state.taskExecutions?.get(taskExecutionRecordKey(binding.source))
    if (!task) {
      return refuseTaskExecution('EXECUTION_NOT_FOUND')
    }
    assertTaskCodexSessionBinding(state, task, binding, true)
  }

  persistDockerIdentity(
    identity: Identity & Pick<TaskExecutionRecord['command'], 'ownershipEpoch'>,
    dockerIdentity: TaskDockerIdentity,
    now: number,
    validate: () => void
  ) {
    return this.update(
      identity,
      (record) => {
        if (record.command.ownershipEpoch !== identity.ownershipEpoch) {
          return refuseTaskExecution('IDEMPOTENCY_CONFLICT')
        }
        if (
          this.transactions.state.taskRecoveryBlocked ||
          record.status !== 'accepted' ||
          record.dispatch !== 'dispatching' ||
          record.cancellationKey ||
          record.result
        ) {
          return refuseTaskExecution('OUTCOME_UNKNOWN')
        }
        return admitTaskDockerIdentity(record, dockerIdentity)
      },
      now,
      () => {
        if (typeof validate !== 'function') {
          return refuseTaskExecution('INVALID_REQUEST')
        }
        assertTaskAuthorizationCurrent(() => validate())
      }
    )
  }

  recoverLaunch(identity: Identity, fingerprint: string, now: number, validate: () => void) {
    return this.update(
      identity,
      (record) => {
        validate()
        if (record.dispatch !== 'dispatching' || record.result) {
          return null
        }
        const row = this.transactions.state.operations.get(
          agentSessionOperationKey(record.operationCallerKey, record.command.operationId)
        )
        if (
          row &&
          (row.callerKey !== record.operationCallerKey ||
            row.operationId !== record.command.operationId ||
            row.fingerprint !== fingerprint)
        ) {
          return refuseTaskExecution('IDEMPOTENCY_CONFLICT')
        }
        if (row?.outcome.status !== 'succeeded' || !isAgentLaunchResult(row.outcome.launch)) {
          return null
        }
        return bindTaskLaunch(record, row.outcome.launch)
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

  markUnknown(
    identity: Identity,
    now: number,
    validate: () => void = () => undefined,
    summary?: string
  ) {
    return this.update(
      identity,
      (record) => {
        validate()
        return record.result ||
          (record.status === 'outcome_unknown' &&
            (!summary || record.events.at(-1)?.summary === summary))
          ? null
          : { ...record, status: 'outcome_unknown' }
      },
      now,
      undefined,
      summary
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
    apply: (record: TaskExecutionRecord, now: number) => TaskExecutionRecord | null,
    now: number | (() => number),
    validate?: () => void,
    summary?: string
  ) {
    return this.transactions.transact(() => {
      validate?.()
      const key = taskExecutionRecordKey(identity)
      const current = this.transactions.state.taskExecutions?.get(key)
      if (!current) {
        return refuseTaskExecution('EXECUTION_NOT_FOUND')
      }
      const recordedAt = typeof now === 'function' ? now() : now
      const next = apply(current, recordedAt)
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
      this.transactions.state.taskExecutions!.set(key, record)
      return { changed: true, record: structuredClone(record) }
    })
  }
}
