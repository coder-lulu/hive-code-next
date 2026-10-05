import { taskExecutionCapabilityRefusal } from '../../shared/task-execution/task-execution-capabilities'
import { admitTaskPrestartCancellation } from './task-prestart-cancellation'
import {
  TaskExecutionCancelSchema,
  TaskExecutionStartSchema,
  type TaskExecutionStart
} from '../../shared/task-execution/task-execution-command'
import {
  TaskExecutionObserveSchema,
  TaskExecutionReconcileSchema
} from '../../shared/task-execution/task-execution-observation'
import { TaskOpaqueRef } from '../../shared/task-execution/task-execution-primitives'
import { refuseTaskExecution } from './task-execution-error'
import { assertTaskAuthorizationCurrent } from './task-structured-launch-origin'
import type { TaskExecutionRecord } from './task-execution-record'
import { taskRecordObservation } from './task-record-observation'
import { collectTaskExecutionSettlement } from './task-execution-settlement'
import { recoverPersistedTaskExecution } from './task-execution-recovery'
import {
  assertTaskExecutionDispatchCurrent,
  prepareTaskExecutionLaunchAuthorization
} from './task-execution-launch-authorization'
import type {
  TaskExecutionCaller,
  TaskExecutionAction,
  TaskExecutionAuthorization,
  TaskExecutionHostDependencies
} from './task-execution-ports'

export type {
  TaskExecutionCaller,
  TaskExecutionAction,
  TaskExecutionAuthorization,
  TaskExecutionCandidate,
  TaskExecutionHostDependencies,
  TaskExecutionStopEvidence
} from './task-execution-ports'

/** Only the authenticated host ports may supply completion and stop evidence. */
export class TaskExecutionHost {
  private readonly launches = new Map<string, Promise<void>>()
  private readonly settlements = new Map<string, Promise<void>>()
  private readonly now: () => number

  constructor(private readonly deps: TaskExecutionHostDependencies) {
    this.now = deps.now ?? Date.now
  }

  /** Close the transport first; draining writes does not prove task termination. */
  async drain() {
    while (this.launches.size || this.settlements.size) {
      await Promise.all([...this.launches.values(), ...this.settlements.values()])
    }
  }

  async recoverPersistedExecution(
    record: TaskExecutionRecord,
    caller: TaskExecutionCaller,
    launchFingerprint: string | null,
    assertAuthorized: () => void
  ): Promise<void> {
    return recoverPersistedTaskExecution({
      store: this.deps.store,
      read: () =>
        this.requireRecord(
          { ...record.command, commandFingerprint: record.commandFingerprint },
          caller
        ),
      isLaunching: (fingerprint) => this.launches.has(fingerprint),
      now: this.now,
      validate: () => assertTaskAuthorizationCurrent(() => caller.assertCurrent?.()),
      assertAuthorized,
      launchFingerprint,
      settle: (current, validate) => this.settle(current, validate),
      cancelRevoked: (current) => this.cancelRevokedExecution(current, caller)
    })
  }

  /** Persist revocation before slow collection; this never proves that the writer stopped. */
  async fenceRevokedExecution(record: TaskExecutionRecord, caller: TaskExecutionCaller) {
    assertTaskAuthorizationCurrent(() => caller.assertCurrent?.())
    const current = this.requireRecord(
      { ...record.command, commandFingerprint: record.commandFingerprint },
      caller
    )
    if (current.result) {
      return
    }
    await this.deps.store.requestCancellation(
      current.command,
      `revoked:${current.commandFingerprint}`,
      this.now(),
      () => assertTaskAuthorizationCurrent(() => caller.assertCurrent?.())
    )
  }

  /** Private Runtime cleanup; a revoked caller cannot authorize another transport operation. */
  async cancelRevokedExecution(record: TaskExecutionRecord, caller: TaskExecutionCaller) {
    await this.fenceRevokedExecution(record, caller)
    const current = this.requireRecord(
      { ...record.command, commandFingerprint: record.commandFingerprint },
      caller
    )
    await this.settle(current, () => assertTaskAuthorizationCurrent(() => caller.assertCurrent?.()))
  }

  async start(value: unknown, caller: TaskExecutionCaller) {
    const parsed = TaskExecutionStartSchema.safeParse(value)
    if (!parsed.success || !TaskOpaqueRef.safeParse(caller.operationCallerKey).success) {
      return refuseTaskExecution('INVALID_REQUEST')
    }
    const command = parsed.data
    const authorization = await this.authorize(caller, command, 'start')
    if (taskExecutionCapabilityRefusal(command, this.deps.capabilities())) {
      return refuseTaskExecution('CAPABILITY_UNAVAILABLE')
    }
    const admitted = await this.deps.store.admit({
      command,
      operationCallerKey: caller.operationCallerKey,
      workspace: authorization.workspace,
      now: this.now(),
      validate: () => assertTaskExecutionDispatchCurrent(authorization)
    })
    if (admitted.created) {
      const key = admitted.record.commandFingerprint
      const flight = this.dispatch(admitted.record, authorization).finally(() =>
        this.launches.delete(key)
      )
      this.launches.set(key, flight)
    }
    assertTaskAuthorizationCurrent(() => authorization.assertCurrent())
    return admitted.record.accepted
  }

  async observe(value: unknown, caller: TaskExecutionCaller) {
    const parsed = TaskExecutionObserveSchema.safeParse(value)
    if (!parsed.success) {
      return refuseTaskExecution('INVALID_REQUEST')
    }
    const query = parsed.data
    const record = this.requireRecord(query, caller)
    await this.authorize(
      caller,
      {
        ...record.command,
        authorizationRef: query.authorizationRef,
        authorizationRevision: query.authorizationRevision,
        expiresAt: query.expiresAt
      },
      'observe'
    )
    return taskRecordObservation(record, query.afterSequence, query.limit)
  }

  async reconcile(value: unknown, caller: TaskExecutionCaller) {
    const parsed = TaskExecutionReconcileSchema.safeParse(value)
    if (!parsed.success) {
      return refuseTaskExecution('INVALID_REQUEST')
    }
    const query = parsed.data
    const record = this.requireRecord(query, caller)
    const authorization = await this.authorize(
      caller,
      {
        ...record.command,
        authorizationRef: query.authorizationRef,
        authorizationRevision: query.authorizationRevision,
        expiresAt: query.expiresAt
      },
      'reconcile'
    )
    await this.settle(record, authorization.assertCurrent)
    assertTaskAuthorizationCurrent(() => authorization.assertCurrent())
    return taskRecordObservation(this.requireRecord(query, caller), 0, 32)
  }

  async cancel(value: unknown, caller: TaskExecutionCaller) {
    const parsed = TaskExecutionCancelSchema.safeParse(value)
    if (!parsed.success) {
      return refuseTaskExecution('INVALID_REQUEST')
    }
    const command = parsed.data
    await admitTaskPrestartCancellation(
      command,
      caller,
      this.deps,
      (actor, start, action) => this.authorize(actor, start, action),
      this.now()
    )
    const record = this.requireRecord(command, caller)
    if (JSON.stringify(record.command.task) !== JSON.stringify(command.task)) {
      return refuseTaskExecution('REVISION_CONFLICT')
    }
    const authorization = await this.authorize(
      caller,
      {
        ...record.command,
        authorizationRef: command.authorizationRef,
        authorizationRevision: command.authorizationRevision,
        expiresAt: command.expiresAt
      },
      'cancel'
    )
    const cancellation = await this.deps.store.requestCancellation(
      command,
      command.idempotencyKey,
      this.now(),
      authorization.assertCurrent
    )
    await this.settle(cancellation.record, authorization.assertCurrent)
    assertTaskAuthorizationCurrent(() => authorization.assertCurrent())
    return taskRecordObservation(this.requireRecord(command, caller), 0, 32)
  }

  private async authorize(
    caller: TaskExecutionCaller,
    command: TaskExecutionStart,
    action: TaskExecutionAction
  ) {
    assertTaskAuthorizationCurrent(() => caller.assertCurrent?.())
    if (
      !TaskOpaqueRef.safeParse(caller.operationCallerKey).success ||
      Date.parse(command.expiresAt) <= this.now()
    ) {
      return refuseTaskExecution('FORBIDDEN')
    }
    if (
      command.ownerScope.kind !== 'personalTenant' ||
      command.executionPolicy.trustMode !== 'trusted_personal_preview'
    ) {
      return refuseTaskExecution('CAPABILITY_UNAVAILABLE')
    }
    const authorization = await this.deps.authorize(caller, command, action)
    const assertCurrent = () => {
      assertTaskAuthorizationCurrent(() => caller.assertCurrent?.())
      assertTaskAuthorizationCurrent(() => authorization.assertCurrent())
    }
    assertCurrent()
    if (action === 'start') {
      assertTaskExecutionDispatchCurrent(authorization)
    }
    return { ...authorization, assertCurrent }
  }

  private requireRecord(
    query: Pick<
      TaskExecutionRecord['accepted'],
      'runtimeRecordId' | 'ownershipEpoch' | 'executionId' | 'executionEpoch' | 'commandFingerprint'
    >,
    caller: TaskExecutionCaller
  ) {
    const record = this.deps.store.get(query)
    if (!record || record.operationCallerKey !== caller.operationCallerKey) {
      return refuseTaskExecution('EXECUTION_NOT_FOUND')
    }
    if (
      query.ownershipEpoch !== record.command.ownershipEpoch ||
      query.commandFingerprint !== record.commandFingerprint
    ) {
      return refuseTaskExecution('IDEMPOTENCY_CONFLICT')
    }
    return record
  }

  private async dispatch(record: TaskExecutionRecord, authorization: TaskExecutionAuthorization) {
    try {
      const dispatch = await prepareTaskExecutionLaunchAuthorization(
        { store: this.deps.store, now: this.now },
        record,
        authorization
      )
      if (dispatch) {
        const launch = await this.deps.launch(dispatch.record, dispatch.authorization)
        await this.deps.store.bindLaunch(record.command, launch, this.now())
      }
    } catch {
      await this.deps.store.markUnknown(record.command, this.now()).catch(() => undefined)
    }
  }

  private async settle(record: TaskExecutionRecord, validate: () => void) {
    if (record.result) {
      return
    }
    const key = record.commandFingerprint
    const active = this.settlements.get(key)
    if (active) {
      return active
    }
    const settlement = collectTaskExecutionSettlement(
      this.deps,
      record,
      this.launches.get(key),
      this.now,
      validate
    ).finally(() => this.settlements.delete(key))
    this.settlements.set(key, settlement)
    return settlement
  }
}
