import type { HiveRuntimeCloudAuthorization } from '../hive-account/hive-account-publication'
import { computeTaskExecutionFingerprint } from '../../shared/task-execution/task-execution-fingerprint'
import type { TaskExecutionStart } from '../../shared/task-execution/task-execution-command'
import type {
  TaskExecutionAction,
  TaskExecutionAuthorization,
  TaskExecutionCaller
} from './task-execution-host'
import { refuseTaskExecution } from './task-execution-error'

export type LocalTaskGrant = TaskExecutionAuthorization & {
  command: TaskExecutionStart
  operationCallerKey: string
  accountId: string
  authorityId: string
  sessionGeneration: number
  validUntil: number
  actions: readonly TaskExecutionAction[]
}

export type LocalTaskAuthorityDependencies = {
  currentAccount: () => HiveRuntimeCloudAuthorization | null
  currentRuntime: () => {
    runtimeRecordId: string
    ownershipEpoch: number
    accountId: string
  } | null
  // A reference names its canonical live grant; deleting or replacing it revokes old admissions.
  resolveGrant: (authorizationRef: string) => LocalTaskGrant | null
  now?: () => number
}

/** Grants originate in the local authenticated binding service, never in transport JSON. */
export function createLocalTaskAuthorizer(deps: LocalTaskAuthorityDependencies) {
  const now = deps.now ?? Date.now
  return async (
    caller: TaskExecutionCaller,
    command: TaskExecutionStart,
    action: TaskExecutionAction
  ) => {
    const grant = deps.resolveGrant(command.authorizationRef)
    if (!grant) {
      return refuseTaskExecution('FORBIDDEN')
    }
    const assertCurrent = () => {
      const account = deps.currentAccount()
      const runtime = deps.currentRuntime()
      if (
        deps.resolveGrant(command.authorizationRef) !== grant ||
        !account ||
        !runtime ||
        account.sessionExpiresAt <= now() ||
        grant.validUntil <= now() ||
        Date.parse(command.expiresAt) > grant.validUntil ||
        Date.parse(command.expiresAt) <= now() ||
        account.accountId !== grant.accountId ||
        account.authorityId !== grant.authorityId ||
        account.sessionGeneration !== grant.sessionGeneration ||
        runtime.accountId !== account.accountId ||
        runtime.runtimeRecordId !== command.runtimeRecordId ||
        runtime.ownershipEpoch !== command.ownershipEpoch ||
        caller.operationCallerKey !== grant.operationCallerKey ||
        !grant.actions.includes(action) ||
        computeTaskExecutionFingerprint(command, caller.operationCallerKey) !==
          computeTaskExecutionFingerprint(grant.command, grant.operationCallerKey)
      ) {
        return refuseTaskExecution('FORBIDDEN')
      }
      grant.assertCurrent()
    }
    assertCurrent()
    return { workspace: grant.workspace, input: grant.input, assertCurrent }
  }
}
