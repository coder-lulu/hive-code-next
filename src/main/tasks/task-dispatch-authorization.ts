import type { TaskExecutionDispatchAuthorization } from './task-execution-ports'
import { assertTaskAuthorizationCurrent } from './task-structured-launch-origin'
import { refuseTaskExecution } from './task-execution-error'

export function requireTaskDispatchAuthorization(
  dispatch: TaskExecutionDispatchAuthorization | undefined
): TaskExecutionDispatchAuthorization {
  if (
    !dispatch ||
    typeof dispatch.prepare !== 'function' ||
    typeof dispatch.assertCurrent !== 'function'
  ) {
    return refuseTaskExecution('FORBIDDEN')
  }
  return dispatch
}

export async function prepareTaskDispatch(
  dispatch: TaskExecutionDispatchAuthorization,
  assertCurrent: () => void
): Promise<void> {
  assertTaskAuthorizationCurrent(assertCurrent)
  if ((await dispatch.prepare()) !== undefined) {
    return refuseTaskExecution('FORBIDDEN')
  }
  assertTaskAuthorizationCurrent(assertCurrent)
  assertTaskAuthorizationCurrent(() => dispatch.assertCurrent())
}
