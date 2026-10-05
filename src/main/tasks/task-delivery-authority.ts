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
    assertTaskAuthorizationCurrent(() => authorization.assertCurrent())
    assertTaskAuthorizationCurrent(() => context.assertCurrent())
    const startedAt = now()
    const parsed = TaskDeliveryProofSchema.safeParse(
      await context.request(
        `/hive/execution-delivery/${encodeURIComponent(command.task.spaceId)}/${encodeURIComponent(command.task.runId)}`
      )
    )
    if (!parsed.success) {
      return refuseTaskExecution('OUTCOME_UNKNOWN')
    }
    const proof = parsed.data
    const remaining = Date.parse(proof.expiresAt) - Date.parse(proof.serverNow)
    if (
      proof.accountId !== context.accountId ||
      proof.companyId !== command.task.spaceId ||
      proof.taskId !== command.task.taskId ||
      proof.runId !== command.task.runId ||
      proof.protocolVersion !== command.protocolVersion ||
      proof.runtimeRecordId !== command.runtimeRecordId ||
      proof.ownershipEpoch !== command.ownershipEpoch ||
      proof.executionId !== command.executionId ||
      proof.executionEpoch !== command.executionEpoch ||
      proof.operationId !== command.operationId ||
      proof.workspaceExecutionClaimRef !== command.workspaceExecutionClaimRef ||
      proof.writeFence !== command.writeFence ||
      proof.commandFingerprint !==
        computeTaskExecutionFingerprint(command, caller.operationCallerKey) ||
      proof.ownerId !== token.data.ownerId ||
      proof.leaseRef !== token.data.leaseRef ||
      proof.generation !== token.data.generation ||
      remaining <= 0 ||
      remaining > 60_000
    ) {
      return refuseTaskExecution('FORBIDDEN')
    }
    // Counting from request start conservatively includes transport and scheduling delays.
    const deadline = startedAt + remaining
    const assertCurrent = () => {
      assertTaskAuthorizationCurrent(() => authorization.assertCurrent())
      assertTaskAuthorizationCurrent(() => context.assertCurrent())
      if (now() >= deadline) {
        return refuseTaskExecution('FORBIDDEN')
      }
    }
    assertCurrent()
    return { ...authorization, assertCurrent }
  }
}
