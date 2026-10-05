import type { TaskSessionSourceReference } from '../../shared/task-execution/task-structured-binding'
import { assertSynchronousAuthorization } from '../../shared/synchronous-authorization-guard'
import { refuseTaskExecution } from './task-execution-error'

export function assertTaskAuthorizationCurrent(check: () => void): void {
  assertSynchronousAuthorization(check, () => refuseTaskExecution('FORBIDDEN'))
}

/** Host-only authorization callback; never accept this object from renderer or RPC JSON. */
export type TaskStructuredLaunchOrigin = {
  source: TaskSessionSourceReference
  operationCallerKey: string
  operationId: string
  launchFingerprint: string
  validate: () => void
}
