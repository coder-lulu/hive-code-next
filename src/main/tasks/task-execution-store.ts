import { updateTaskExecutionRecord } from './task-execution-record-mutation'
import { admitTaskExecutionResult } from './task-execution-result-admission'
import type { AgentLaunchResult } from '../../shared/agent-launch-intent'
import {
  TaskStructuredBindingSchema,
  type TaskStructuredBinding
} from '../../shared/task-execution/task-structured-binding'
import type { TaskExecutionResult } from '../../shared/task-execution/task-execution-receipts'
import type { AgentSessionStoreTransactions } from '../runtime/agent-session-store-transactions'
import type { AgentSessionStoreState } from '../runtime/agent-session-store-contract'
import {
  admitTaskExecution,
  beginTaskDispatch,
  type TaskExecutionAdmission
} from './task-execution-admission'
import { admitCurrentTaskDockerIdentity } from './task-docker-identity-admission'
import type { TaskDockerIdentity } from './task-docker-identity'
import { refuseTaskExecution } from './task-execution-error'
import { runTaskModelEffect, reserveTaskModelDispatch } from './task-model-dispatch-reservation'
import { bindTaskLaunch, recoverTaskLaunch } from './task-launch-binding'
import { settleCancelledTaskCodexDispatch } from './task-cancelled-dispatch'
import { assertTaskExecutionSnapshotCurrent } from './task-execution-snapshot-guard'
import type { AgentSessionRecord } from '../../shared/agent-session-record'
import type { TaskDockerNeverStartedEvidence } from './task-docker-boundary'
import { settleCancelledTaskDockerPrestart } from './task-cancelled-docker-prestart'
import {
  assertStoredTaskStructuredBinding,
  assertTaskCodexFailedBootBinding
} from './task-codex-session-binding'
import { assertTaskAuthorizationCurrent } from './task-structured-launch-origin'
import { hasTaskSessionBinding } from './task-session-association'
import {
  assertTaskFailureSnapshotCurrent,
  runRecordedTaskModelFailureEffect,
  taskModelFailureEventCandidate
} from './task-failure-event'
import { readTaskModelFatalFailure, forgetTaskModelFatalFailure } from './task-model-fatal-failure'
import {
  hasTaskFailureSummary,
  taskFailureSummary,
  type TaskFailureError
} from './task-failure-diagnostic'
import { taskExecutionRecordKey, type TaskExecutionRecord } from './task-execution-record'

type Identity = Parameters<typeof taskExecutionRecordKey>[0]

/** Business bindings share the runtime's single writer; launch deduplication stays in its ledger. */
export class TaskExecutionPersistence {
  constructor(private readonly transactions: AgentSessionStoreTransactions) {}

  get(identity: Identity): TaskExecutionRecord | null {
    return structuredClone(
      this.transactions.state.taskExecutions?.get(taskExecutionRecordKey(identity)) ?? null
    )
  }

  hasSessionBinding(sessionId: string): boolean {
    return hasTaskSessionBinding(this.transactions.state.taskExecutions, sessionId)
  }

  listActive(): TaskExecutionRecord[] {
    return structuredClone(
      [...(this.transactions.state.taskExecutions?.values() ?? [])].filter(
        (record) => !record.result
      )
    )
  }

  settleCancelledCodexDispatch(
    expected: TaskExecutionRecord,
    fingerprint: string,
    readNow: () => number,
    validate: () => void
  ) {
    return this.update(
      expected.command,
      (record, now, state) => {
        validate()
        assertTaskExecutionSnapshotCurrent(expected, record)
        return settleCancelledTaskCodexDispatch(state, record, fingerprint, now, expected)
      },
      readNow
    )
  }

  readActive(validate: () => void): Promise<TaskExecutionRecord[]> {
    return this.transactions.transact((draft) => {
      validate()
      return structuredClone(
        [...(draft.taskExecutions?.values() ?? [])].filter((record) => !record.result)
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
      (record, now, state) => {
        validate()
        assertTaskExecutionSnapshotCurrent(authorized, record)
        assertTaskExecutionSnapshotCurrent(expected, record)
        return settleCancelledTaskDockerPrestart(
          state,
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
    return this.transactions.transact((draft) => admitTaskExecution(draft, input))
  }

  async beginDispatch(
    identity: Identity,
    now: number,
    validate: (record: TaskExecutionRecord) => void
  ) {
    return this.update(
      identity,
      (record, _now, state) => beginTaskDispatch(state, record, validate),
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
      (record, _now, state) => reserveTaskModelDispatch(state, record, snapshot.data),
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
    return runTaskModelEffect(this.transactions, binding, validate, start)
  }

  assertStructuredBindingCurrent(binding: TaskStructuredBinding): void {
    assertStoredTaskStructuredBinding(this.transactions.state, binding)
  }

  assertFailedBootStopCurrent(expected: TaskExecutionRecord, requireStopped = false) {
    return this.transactions.transact((draft) =>
      structuredClone(
        assertTaskCodexFailedBootBinding(
          draft,
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
      (record, _now, state) =>
        admitCurrentTaskDockerIdentity(state, record, identity, dockerIdentity),
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
      (record, _now, state) => recoverTaskLaunch(state, record, expected, fingerprint, validate),
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
      (record, _now, state) => {
        validate(record)
        if (diagnostic) {
          assertTaskFailureSnapshotCurrent(state, expected!, record)
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
      (record, _now, state) => taskModelFailureEventCandidate(state, snapshot, record),
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
    return runRecordedTaskModelFailureEffect(this.transactions, expected, apply)
  }

  settle(
    identity: Identity,
    resultValue: TaskExecutionResult | ((record: TaskExecutionRecord) => TaskExecutionResult),
    now: number,
    stopping?: TaskExecutionRecord
  ) {
    return this.update(
      identity,
      (record, _now, state) =>
        admitTaskExecutionResult(state, record, resultValue, stopping, () =>
          Boolean(readTaskModelFatalFailure(this, record))
        ),
      now
    ).then((settled) => {
      forgetTaskModelFatalFailure(this, settled.record)
      return settled
    })
  }

  private update(
    identity: Identity,
    apply: (
      record: TaskExecutionRecord,
      now: number,
      state: AgentSessionStoreState
    ) => TaskExecutionRecord | null,
    now: number | (() => number),
    validate?: () => void,
    summary?: string
  ) {
    return updateTaskExecutionRecord(this.transactions, identity, apply, now, validate, summary)
  }
}
