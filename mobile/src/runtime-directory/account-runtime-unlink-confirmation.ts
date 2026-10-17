import type { MobileSession } from '../auth/mobile-sms-auth'
import type { AccountRuntimeDirectoryScope } from './account-runtime-directory-types'
import type { AccountRuntimeDirectoryStore } from './account-runtime-directory-store'
import {
  invalidateAccountRuntimeDirectoryOperations,
  type AccountRuntimeDirectoryOperationState
} from './account-runtime-directory-operations'
import { mobileSessionMatchesDirectoryScope } from './account-runtime-session-operation'
import { forgetUnlinkedAccountRuntime } from './account-runtime-client-reconciliation'

export function createRuntimeUnlinkConfirmation(
  store: AccountRuntimeDirectoryStore,
  operations: AccountRuntimeDirectoryOperationState,
  sessionRef: { current: MobileSession | null },
  forgetHostClient: (hostId: string) => void
): (
  runtimeRecordId: string,
  expectedScope: AccountRuntimeDirectoryScope,
  expectedResourceVersion: number
) => boolean {
  return (runtimeRecordId, expectedScope, expectedResourceVersion) => {
    if (!mobileSessionMatchesDirectoryScope(sessionRef.current, expectedScope)) {
      throw new Error('mobile_session_required')
    }
    if (!store.confirmRuntimeUnlinked(runtimeRecordId, expectedScope, expectedResourceVersion)) {
      return false
    }
    invalidateAccountRuntimeDirectoryOperations(operations)
    forgetUnlinkedAccountRuntime(runtimeRecordId, forgetHostClient)
    return true
  }
}
