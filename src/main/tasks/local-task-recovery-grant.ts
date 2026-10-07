import { randomUUID } from 'node:crypto'
import type { HiveRuntimeCloudAuthorization } from '../hive-account/hive-account-publication'
import type { LocalTaskRuntimeOwner } from './local-task-binding-issuer'
import type { LocalTaskGrant } from './local-task-authority'
import type { HiveRuntimeBinding } from './paperclip-adapter-contract'
import { refuseTaskExecution } from './task-execution-error'
import { assertTaskAuthorizationCurrent } from './task-structured-launch-origin'

type Owner = { account: HiveRuntimeCloudAuthorization; runtime: LocalTaskRuntimeOwner }

export function createRecoveredLocalTaskGrant(
  entry: Pick<LocalTaskGrant, 'input' | 'workspace' | 'accountId'> & {
    binding: HiveRuntimeBinding
    assertWorkspaceCurrent(): void
  },
  owner: Owner,
  requireOwner: () => Owner,
  operationCallerKey: string
): LocalTaskGrant {
  if (
    entry.accountId !== owner.account.accountId ||
    entry.binding.command.runtimeRecordId !== owner.runtime.runtimeRecordId ||
    owner.runtime.ownershipEpoch < entry.binding.command.ownershipEpoch
  ) {
    return refuseTaskExecution('FORBIDDEN')
  }
  const assertCurrent = () => {
    const current = requireOwner()
    if (
      current.account.accountId !== owner.account.accountId ||
      current.account.authorityId !== owner.account.authorityId ||
      current.account.sessionGeneration !== owner.account.sessionGeneration ||
      current.runtime.runtimeRecordId !== owner.runtime.runtimeRecordId ||
      current.runtime.ownershipEpoch !== owner.runtime.ownershipEpoch
    ) {
      return refuseTaskExecution('FORBIDDEN')
    }
    assertTaskAuthorizationCurrent(() => entry.assertWorkspaceCurrent())
  }
  assertCurrent()
  return {
    command: { ...entry.binding.command, authorizationRef: `authorization:${randomUUID()}` },
    operationCallerKey,
    accountId: owner.account.accountId,
    authorityId: owner.account.authorityId,
    sessionGeneration: owner.account.sessionGeneration,
    runtimeOwnershipEpoch: owner.runtime.ownershipEpoch,
    validUntil: owner.account.sessionExpiresAt,
    actions: ['observe', 'reconcile', 'cancel'],
    workspace: entry.workspace,
    input: entry.input,
    assertCurrent
  }
}
