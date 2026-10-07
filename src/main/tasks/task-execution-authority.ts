import type { TaskExecutionStart } from '../../shared/task-execution/task-execution-command'
import { TaskOpaqueRef } from '../../shared/task-execution/task-execution-primitives'
import { assertTaskExecutionStartDeadlineCurrent } from './task-execution-budget'
import { isTaskDockerEnforcementPolicy } from './task-docker-enforcement'
import { refuseTaskExecution } from './task-execution-error'
import { assertTaskExecutionDispatchCurrent } from './task-execution-launch-authorization'
import type {
  TaskExecutionAction,
  TaskExecutionCaller,
  TaskExecutionHostDependencies
} from './task-execution-ports'
import { assertTaskAuthorizationCurrent } from './task-structured-launch-origin'

export async function authorizeTaskExecution(
  deps: TaskExecutionHostDependencies & {
    authorizeEnforcement?(command: TaskExecutionStart, action: TaskExecutionAction): Promise<void>
  },
  now: () => number,
  caller: TaskExecutionCaller,
  command: TaskExecutionStart,
  action: TaskExecutionAction
) {
  assertTaskAuthorizationCurrent(() => caller.assertCurrent?.())
  if (
    !TaskOpaqueRef.safeParse(caller.operationCallerKey).success ||
    Date.parse(command.expiresAt) <= now()
  ) {
    return refuseTaskExecution('FORBIDDEN')
  }
  if (command.ownerScope.kind !== 'personalTenant') {
    return refuseTaskExecution('CAPABILITY_UNAVAILABLE')
  }
  if (
    command.executionPolicy.trustMode === 'enforced_autonomous' &&
    (!deps.authorizeEnforcement || !isTaskDockerEnforcementPolicy(command.executionPolicy))
  ) {
    return refuseTaskExecution('CAPABILITY_UNAVAILABLE')
  }
  const authorization = await deps.authorize(caller, command, action)
  const assertCurrent = () => {
    assertTaskAuthorizationCurrent(() => caller.assertCurrent?.())
    assertTaskAuthorizationCurrent(() => authorization.assertCurrent())
    if (action === 'start') {
      assertTaskExecutionStartDeadlineCurrent(command, now())
    }
  }
  if (
    command.executionPolicy.trustMode === 'enforced_autonomous' &&
    (await deps.authorizeEnforcement?.(command, action)) !== undefined
  ) {
    return refuseTaskExecution('FORBIDDEN')
  }
  assertCurrent()
  if (action === 'start') {
    assertTaskExecutionDispatchCurrent(authorization)
  }
  return { ...authorization, assertCurrent }
}
