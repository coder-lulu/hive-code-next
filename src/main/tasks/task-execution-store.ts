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
import type { AgentSessionRecord } from '../../shared/agent-session-record'
import type { TaskDockerNeverStartedEvidence } from './task-docker-boundary'
import { settleCancelledTaskDockerPrestart } from './task-cancelled-docker-prestart'
import {
  assertTaskCodexSessionBinding,
  assertTaskCodexFailedBootBinding
} from './task-codex-session-binding'
import { assertTaskAuthorizationCurrent } from './task-structured-launch-origin'
import { hasTaskSessionBinding } from './task-session-association'
import { assertTaskFailureSnapshotCurrent } from './task-failure-event'
import { readTaskModelFatalFailure, forgetTaskModelFatalFailure } from './task-model-fatal-failure'
import {
  hasTaskFailureSummary,
  taskFailureSummary,
  type TaskFailureError
} from './task-failure-diagnostic'
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

  settleCancelledDockerPrestart(
    authorized: TaskExecutionRecord,
    expected: TaskExecutionRecord,
    session: AgentSessionRecord,
    evidence: TaskDockerNeverStartedEvidence,
    readNow: () => number,
    validate: () => void
  ) {
    return this.update(
      authorized.command,
      (record, now) => {
        validate()
        assertTaskExecutionSnapshotCurrent(authorized, record)
        assertTaskExecutionSnapshotCurrent(expected, record)
        return settleCancelledTaskDockerPrestart(
          this.transactions.state,
          record,
          authorized,
          expected,
          session,
          evidence,
          now
        )
      },
      readNow
    )
  }

  admit(input: TaskExecutionAdmission) {
    return this.transactions.transact(() => admitTaskExecution(this.transactions.state, input))
  }

  async beginDispatch(
    identity: Identity,
    now: number,
    validate: (record: TaskExecutionRecord) => void
  ) {
    return this.update(
      identity,
      (record) => {
        validate(record)
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

  bindLaunch(expected: TaskExecutionRecord, launch: AgentLaunchResult, now: number) {
    return this.update(
      expected.command,
      (record) => {
        assertTaskExecutionSnapshotCurrent(expected, record)
        return bindTaskLaunch(record, launch)
      },
      now
    )
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

  assertFailedBootStopCurrent(expected: TaskExecutionRecord, requireStopped = false) {
    return this.transactions.transact(() =>
      structuredClone(
        assertTaskCodexFailedBootBinding(
          this.transactions.state,
          expected,
          requireStopped,
          Boolean(readTaskModelFatalFailure(this, expected))
        )
      )
    )
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

  recoverLaunch(
    expected: TaskExecutionRecord,
    fingerprint: string,
    now: number,
    validate: () => void
  ) {
    return this.update(
      expected.command,
      (record) => {
        assertTaskExecutionSnapshotCurrent(expected, record)
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
    validate: (record: TaskExecutionRecord) => void,
    diagnostic?: { expected: TaskExecutionRecord; failure: TaskFailureError }
  ) {
    const expected = diagnostic ? structuredClone(diagnostic.expected) : undefined
    const summary = diagnostic ? taskFailureSummary('authorization', diagnostic.failure) : undefined
    return this.update(
      identity,
      (record) => {
        validate(record)
        if (diagnostic) {
          assertTaskFailureSnapshotCurrent(this.transactions.state, expected!, record)
        }
        if (record.result || record.cancellationKey) {
          return diagnostic && !hasTaskFailureSummary(record.events, 'authorization')
            ? { ...record }
            : null
        }
        return { ...record, cancellationKey, status: 'cancel_requested' }
      },
      now,
      undefined,
      summary
    )
  }

  recordModelFailure(expected: TaskExecutionRecord, failure: TaskFailureError, now: number) {
    const snapshot = structuredClone(expected)
    const summary = taskFailureSummary('model', failure)
    return this.update(
      snapshot.command,
      (record) => {
        assertTaskFailureSnapshotCurrent(this.transactions.state, snapshot, record)
        if (!snapshot.structuredBinding) {
          return refuseTaskExecution('OUTCOME_UNKNOWN')
        }
        return hasTaskFailureSummary(record.events, 'model') ? null : { ...record }
      },
      now,
      undefined,
      summary
    )
  }

  markUnknown(
    identity: Identity,
    now: number,
    validate: (record: TaskExecutionRecord) => void = () => undefined,
    summary?: string
  ) {
    return this.update(
      identity,
      (record) => {
        validate(record)
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

  runRecordedModelFailureEffect(
    expected: TaskExecutionRecord,
    apply: (current: TaskExecutionRecord) => void
  ) {
    return this.transactions.transact(() => {
      const current = this.transactions.state.taskExecutions?.get(
        taskExecutionRecordKey(expected.command)
      )
      if (!current || current.result || current.cancellationKey) {
        return
      }
      assertTaskFailureSnapshotCurrent(this.transactions.state, expected, current)
      const session =
        current.structuredBinding &&
        this.transactions.state.records.get(current.structuredBinding.sessionId)
      if (!session || session.lease.unreconciled) {
        return refuseTaskExecution('OUTCOME_UNKNOWN')
      }
      assertTaskAuthorizationCurrent(() => apply(structuredClone(current)))
    })
  }

  settle(
    identity: Identity,
    resultValue: TaskExecutionResult | ((record: TaskExecutionRecord) => TaskExecutionResult),
    now: number,
    stopping?: TaskExecutionRecord
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
        const fatal = Boolean(readTaskModelFatalFailure(this, record))
        if (
          (result.status === 'cancelled' || (result.status === 'failed' && fatal)) &&
          result.stopProof.evidenceKind === 'stopped' &&
          (fatal ||
            (record.dispatch === 'dispatching' && record.structuredBinding) ||
            (stopping?.dispatch === 'dispatching' && stopping.structuredBinding))
        ) {
          if (!stopping) {
            return refuseTaskExecution('OUTCOME_UNKNOWN')
          }
          assertTaskExecutionSnapshotCurrent(stopping, record)
          assertTaskCodexFailedBootBinding(
            this.transactions.state,
            fatal ? record : stopping,
            true,
            fatal
          )
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
    ).then((settled) => {
      forgetTaskModelFatalFailure(this, settled.record)
      return settled
    })
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
