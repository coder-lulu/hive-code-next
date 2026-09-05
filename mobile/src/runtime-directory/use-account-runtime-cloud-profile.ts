import { useCallback, type MutableRefObject } from 'react'
import { resolveHiveRuntimeDisplayName } from '../../../src/shared/hive-runtime-display-name'
import { disposeHiveAccountRelayMaterial } from '../../../src/shared/hive-account-relay-material'
import { mobileSessionMatchesOperationScope } from './account-runtime-session-operation'
import type { MobileSession } from '../auth/mobile-sms-auth'
import type { HostProfile } from '../transport/types'
import { createAccountRuntimeConnectionIntent } from './account-runtime-directory-client'
import { accountRuntimeCanRequestConnection } from './account-runtime-connectability'
import type { AccountRuntimeDirectoryStore } from './account-runtime-directory-store'
import type { AccountRuntimeDirectoryEntry } from './account-runtime-directory-types'

type WithCurrentSession = <T>(operation: (session: MobileSession) => Promise<T>) => Promise<T>

export function useAccountRuntimeCloudProfile(args: {
  pendingDisplayNames: ReadonlyMap<string, string | null>
  directoryStore: AccountRuntimeDirectoryStore
  sessionRef: MutableRefObject<MobileSession | null>
  withCurrentSession: WithCurrentSession
}): (entry: AccountRuntimeDirectoryEntry) => HostProfile | null {
  return useCallback(
    (entry: AccountRuntimeDirectoryEntry): HostProfile | null => {
      const profileSession = args.sessionRef.current
      if (!accountRuntimeCanRequestConnection(entry) || !profileSession) {
        return null
      }
      return {
        id: entry.runtimeRecordId,
        runtimeRecordId: entry.runtimeRecordId,
        name: resolveHiveRuntimeDisplayName({
          ...(args.pendingDisplayNames.has(entry.runtimeRecordId)
            ? { pendingDesiredName: args.pendingDisplayNames.get(entry.runtimeRecordId)! }
            : {}),
          cloudDisplayName: entry.cloudDisplayName,
          reportedDeviceName: entry.deviceName,
          runtimeRecordId: entry.runtimeRecordId
        }),
        endpoint: `cloud://${entry.runtimeRecordId}`,
        deviceToken: '',
        publicKeyB64: '',
        lastConnected: Date.parse(entry.lastHeartbeatAt ?? entry.claimedAt),
        accountRuntime: {
          runtimeRecordId: entry.runtimeRecordId,
          resourceVersion: entry.resourceVersion,
          createConnection: async (signal) => {
            const expectedScope = args.directoryStore.getSnapshot().scope
            const expectedSession = args.sessionRef.current
            if (
              !mobileSessionMatchesOperationScope(expectedSession, profileSession) ||
              !expectedScope ||
              !expectedSession ||
              expectedSession.account.accountId !== expectedScope.accountId ||
              expectedSession.authorityId !== expectedScope.authorityId
            ) {
              throw new Error('mobile_session_required')
            }
            return args.withCurrentSession(async (session) => {
              const material = await createAccountRuntimeConnectionIntent(
                session,
                entry.runtimeRecordId,
                entry.resourceVersion,
                signal
              )
              if (
                signal?.aborted ||
                !mobileSessionMatchesOperationScope(args.sessionRef.current, profileSession)
              ) {
                disposeHiveAccountRelayMaterial(material)
                throw new Error('mobile_session_required')
              }
              return material
            })
          }
        }
      }
    },
    [args.directoryStore, args.pendingDisplayNames, args.sessionRef, args.withCurrentSession]
  )
}
