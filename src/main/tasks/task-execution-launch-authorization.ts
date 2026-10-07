import { isDeepStrictEqual } from 'node:util'
import type {
  TaskExecutionAuthorization,
  TaskExecutionCaller,
  TaskExecutionHostDependencies
} from './task-execution-ports'
import type { TaskExecutionRecord } from './task-execution-record'
import type { TaskExecutionPersistence } from './task-execution-store'
import { refuseTaskExecution } from './task-execution-error'
import { assertTaskAuthorizationCurrent } from './task-structured-launch-origin'
import { assertTaskExecutionSnapshotCurrent } from './task-execution-snapshot-guard'
import { taskDispatchFailureSummary } from './task-dispatch-failure'

export type TaskExecutionRecordLookup = Pick<
  TaskExecutionRecord['accepted'],
  'runtimeRecordId' | 'ownershipEpoch' | 'executionId' | 'executionEpoch' | 'commandFingerprint'
>

export function requireTaskExecutionRecord(
  store: Pick<TaskExecutionPersistence, 'get'>,
  query: TaskExecutionRecordLookup,
  caller: TaskExecutionCaller
) {
  const record = store.get(query)
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

export async function dispatchTaskExecution(
  deps: TaskExecutionHostDependencies,
  now: () => number,
  record: TaskExecutionRecord,
  authorization: TaskExecutionAuthorization
) {
  try {
    const dispatch = await prepareTaskExecutionLaunchAuthorization(
      { store: deps.store, now },
      record,
      authorization
    )
    if (dispatch) {
      const launch = await deps.launch(dispatch.record, dispatch.authorization)
      await deps.store.bindLaunch(record, launch, now())
    }
  } catch (error) {
    await deps.store
      .markUnknown(
        record.command,
        now(),
        (latest) => assertTaskExecutionSnapshotCurrent(record, latest),
        taskDispatchFailureSummary(error)
      )
      .catch(() => undefined)
  }
}

export function assertTaskExecutionDispatchCurrent(
  authorization: TaskExecutionAuthorization
): void {
  assertTaskAuthorizationCurrent(() => authorization.assertCurrent())
  const dispatch = authorization.dispatch
  if (dispatch) {
    assertTaskAuthorizationCurrent(() => dispatch.assertCurrent())
  }
}

export async function prepareTaskExecutionLaunchAuthorization(
  context: { store: Pick<TaskExecutionPersistence, 'get' | 'beginDispatch'>; now: () => number },
  record: TaskExecutionRecord,
  authorization: TaskExecutionAuthorization
) {
  const dispatch = await context.store.beginDispatch(record.command, context.now(), (current) => {
    assertTaskExecutionSnapshotCurrent(record, current)
    assertTaskExecutionDispatchCurrent(authorization)
  })
  if (!dispatch.changed) {
    return null
  }
  const scoped = createTaskExecutionLaunchAuthorization(
    context.store,
    dispatch.record,
    authorization
  )
  scoped.assertCurrent()
  return { record: dispatch.record, authorization: scoped }
}

/** Continuing effects retain the original source; dispatch permission never survives binding. */
export function createTaskExecutionLaunchAuthorization(
  store: Pick<TaskExecutionPersistence, 'get'>,
  record: TaskExecutionRecord,
  authorization: TaskExecutionAuthorization
): TaskExecutionAuthorization {
  const readCurrent = () => {
    assertTaskAuthorizationCurrent(() => authorization.assertCurrent())
    const current = store.get(record.command)
    if (
      !current ||
      current.operationCallerKey !== record.operationCallerKey ||
      current.commandFingerprint !== record.commandFingerprint ||
      !isDeepStrictEqual(current.command, record.command) ||
      !isDeepStrictEqual(current.workspace, record.workspace) ||
      current.cancellationKey ||
      current.result ||
      !(
        (current.status === 'accepted' && current.dispatch === 'dispatching') ||
        (current.status === 'running' && current.dispatch === 'bound')
      ) ||
      (current.dispatch === 'dispatching' && current.launch !== null) ||
      (current.dispatch === 'bound' &&
        (!current.launch || current.launch.worktreeId !== record.workspace.workspaceId)) ||
      (record.structuredBinding &&
        !isDeepStrictEqual(current.structuredBinding, record.structuredBinding))
    ) {
      return refuseTaskExecution('OUTCOME_UNKNOWN')
    }
    return current
  }
  const assertCurrent = () => {
    readCurrent()
  }
  const dispatch = authorization.dispatch
  if (!dispatch) {
    return { ...authorization, assertCurrent }
  }
  const assertDispatching = () => {
    if (readCurrent().dispatch !== 'dispatching') {
      return refuseTaskExecution('OUTCOME_UNKNOWN')
    }
  }
  const assertDispatchCurrent = () => {
    assertDispatching()
    assertTaskAuthorizationCurrent(() => dispatch.assertCurrent())
  }
  return {
    ...authorization,
    assertCurrent,
    dispatch: {
      async prepare() {
        assertDispatching()
        const prepared = await dispatch.prepare()
        if (prepared !== undefined) {
          return refuseTaskExecution('FORBIDDEN')
        }
        assertDispatchCurrent()
      },
      assertCurrent: assertDispatchCurrent
    }
  }
}
