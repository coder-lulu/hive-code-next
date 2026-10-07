import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import type { HiveRuntimeCloudAuthorization } from '../hive-account/hive-account-publication'
import type { LocalTaskRuntimeOwner } from './local-task-binding-issuer'
import type { TaskExecutionStart } from '../../shared/task-execution/task-execution-command'
import { TASK_ENFORCEMENT_CAPABILITY } from '../../shared/task-execution/task-execution-primitives'
import { readTaskDockerRuntimeConfiguration } from './task-docker-runtime-configuration'
import {
  assertTaskDockerEnforcementCommand,
  probeTaskDockerEnforcement,
  type TaskDockerEnforcement
} from './task-docker-enforcement'
import type { TaskExecutionAction } from './task-execution-ports'
import { refuseTaskExecution } from './task-execution-error'
import { assertTaskAuthorizationCurrent } from './task-structured-launch-origin'

/** The private facade and issuer share host proof; every start refreshes actual Docker evidence. */
export function createLocalTaskDockerEnforcement(options: {
  userDataPath: string
  currentRuntime(): LocalTaskRuntimeOwner | null
  account: { getRuntimeCloudAuthorization(): HiveRuntimeCloudAuthorization | null }
  assertCurrent(): void
}) {
  let last: TaskDockerEnforcement | null = null
  const probe = async () => {
    last = null
    const runtime = options.currentRuntime()
    const account = options.account.getRuntimeCloudAuthorization()
    if (!runtime || !account || runtime.accountId !== account.accountId) {
      return refuseTaskExecution('FORBIDDEN')
    }
    const authority = {
      accountId: account.accountId,
      authorityId: account.authorityId,
      sessionGeneration: account.sessionGeneration
    }
    const assertCurrent = () => {
      assertTaskAuthorizationCurrent(() => options.assertCurrent())
      const currentAccount = options.account.getRuntimeCloudAuthorization()
      if (
        !isDeepStrictEqual(options.currentRuntime(), runtime) ||
        !currentAccount ||
        currentAccount.sessionExpiresAt <= Date.now() ||
        !isDeepStrictEqual(authority, {
          accountId: currentAccount.accountId,
          authorityId: currentAccount.authorityId,
          sessionGeneration: currentAccount.sessionGeneration
        })
      ) {
        return refuseTaskExecution('FORBIDDEN')
      }
    }
    const proof = await probeTaskDockerEnforcement({
      configuration: () => readTaskDockerRuntimeConfiguration(options.userDataPath),
      owner: {
        runtimeRecordId: runtime.runtimeRecordId,
        ownershipEpoch: runtime.ownershipEpoch,
        executionAccountRef: `account:${createHash('sha256').update(JSON.stringify(account.accountId)).digest('hex')}`
      },
      assertCurrent
    })
    proof.assertCurrent()
    last = proof
    return proof
  }
  const current = async () => {
    try {
      if (last) {
        last.assertCurrent()
        return last
      }
    } catch {
      last = null
    }
    return probe()
  }
  return {
    probe,
    current,
    capabilities() {
      try {
        if (last) {
          last.assertCurrent()
          return [TASK_ENFORCEMENT_CAPABILITY]
        }
      } catch {
        last = null
      }
      return []
    },
    async authorize(command: TaskExecutionStart, action: TaskExecutionAction) {
      if (action === 'start') {
        assertTaskDockerEnforcementCommand(command, await probe())
      }
    }
  }
}
