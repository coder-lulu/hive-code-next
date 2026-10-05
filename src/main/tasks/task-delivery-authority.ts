import {
  TaskDeliveryProofSchema,
  TaskDeliveryTokenSchema
} from '../../shared/task-execution/task-command-delivery'
import { computeTaskExecutionFingerprint } from '../../shared/task-execution/task-execution-fingerprint'
import type { TaskExecutionHostDependencies } from './task-execution-ports'
import type { HiveTaskServiceContext } from './hive-task-service-context'
import { refuseTaskExecution } from './task-execution-error'
import { assertTaskAuthorizationCurrent } from './task-structured-launch-origin'

/** Only private DB facts authorize a delivery; request headers identify a lease, never prove it. */
export function createTaskDeliveryAuthorizer(options: {
  authorize: TaskExecutionHostDependencies['authorize']
  context(): Promise<HiveTaskServiceContext>
  monotonicNow?: () => number
}): TaskExecutionHostDependencies['authorize'] {
  const now = options.monotonicNow ?? (() => performance.now())
  return async (caller, command, action) => {
    const authorization = await options.authorize(caller, command, action)
    assertTaskAuthorizationCurrent(() => authorization.assertCurrent())
    if (action !== 'start') {
      return authorization
    }
    const token = TaskDeliveryTokenSchema.safeParse(caller.delivery)
    if (!token.success) {
      return refuseTaskExecution('FORBIDDEN')
    }
    const context = await options.context()
    const assertCurrent = () => {
      assertTaskAuthorizationCurrent(() => authorization.assertCurrent())
      assertTaskAuthorizationCurrent(() => context.assertCurrent())
    }
    assertCurrent()
    const expected = {
      accountId: context.accountId,
      companyId: command.task.spaceId,
      taskId: command.task.taskId,
      runId: command.task.runId,
      protocolVersion: command.protocolVersion,
      runtimeRecordId: command.runtimeRecordId,
      ownershipEpoch: command.ownershipEpoch,
      executionId: command.executionId,
      executionEpoch: command.executionEpoch,
      operationId: command.operationId,
      workspaceExecutionClaimRef: command.workspaceExecutionClaimRef,
      writeFence: command.writeFence,
      commandFingerprint: computeTaskExecutionFingerprint(command, caller.operationCallerKey),
      ...token.data
    }
    const path = `/hive/execution-delivery/${encodeURIComponent(command.task.spaceId)}/${encodeURIComponent(command.task.runId)}`
    let deadline = 0
    let flight: Promise<void> | null = null
    const assertDispatchCurrent = () => {
      assertCurrent()
      if (now() >= deadline) {
        return refuseTaskExecution('FORBIDDEN')
      }
    }
    const refresh = async () => {
      deadline = 0
      assertCurrent()
      const startedAt = now()
      const response = await context.request(path)
      assertCurrent()
      const parsed = TaskDeliveryProofSchema.safeParse(response)
      if (!parsed.success) {
        return refuseTaskExecution('OUTCOME_UNKNOWN')
      }
      const proof = parsed.data
      const remaining = Date.parse(proof.expiresAt) - Date.parse(proof.serverNow)
      if (
        Object.entries(expected).some(([key, value]) => Reflect.get(proof, key) !== value) ||
        remaining <= 0 ||
        remaining > 60_000
      ) {
        return refuseTaskExecution('FORBIDDEN')
      }
      // Counting from request start conservatively includes transport and scheduling delays.
      deadline = startedAt + remaining
      assertDispatchCurrent()
    }
    const prepare = () => {
      flight ??= refresh().finally(() => {
        flight = null
      })
      return flight
    }
    const dispatch = { prepare, assertCurrent: assertDispatchCurrent }
    await dispatch.prepare()
    dispatch.assertCurrent()
    return { ...authorization, assertCurrent, dispatch }
  }
}
