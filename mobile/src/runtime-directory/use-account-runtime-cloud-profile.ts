import { useCallback, type MutableRefObject } from 'react'
import { resolveHiveRuntimeDisplayName } from '../../../src/shared/hive-runtime-display-name'
import { disposeHiveAccountRelayMaterial } from '../../../src/shared/hive-account-relay-material'
import { mobileSessionMatchesOperationScope } from './account-runtime-session-operation'
import { MobileApiError } from '../auth/mobile-sms-client'
import type { MobileSession } from '../auth/mobile-sms-auth'
import type { HostProfile } from '../transport/types'
import {
  createAccountRuntimeConnectionIntent,
  loadAllAccountRuntimes
} from './account-runtime-directory-client'
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
      let latestEntry = entry
      return {
        id: entry.runtimeRecordId,
        runtimeRecordId: entry.runtimeRecordId,
        name: resolveHiveRuntimeDisplayName({
          cloudDisplayName: args.pendingDisplayNames.has(entry.runtimeRecordId)
            ? args.pendingDisplayNames.get(entry.runtimeRecordId)
            : entry.cloudDisplayName,
          reportedDeviceName: entry.deviceName,
          runtimeRecordId: entry.runtimeRecordId
        }),
        endpoint: `cloud://${entry.runtimeRecordId}`,
        deviceToken: '',
        publicKeyB64: '',
        // Cloud presence does not establish a connection from this phone.
        lastConnected: 0,
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
            const assertCurrent = () => {
              if (signal?.aborted) {
                throw new Error('runtime_connection_cancelled')
              }
              if (!mobileSessionMatchesOperationScope(args.sessionRef.current, profileSession)) {
                throw new Error('mobile_session_required')
              }
              const snapshot = args.directoryStore.getSnapshot()
              if (
                snapshot.scope?.accountId !== expectedScope.accountId ||
                snapshot.scope.authorityId !== expectedScope.authorityId
              ) {
                throw new Error('mobile_session_required')
              }
            }
            return args.withCurrentSession(async (session) => {
              assertCurrent()
              const currentEntry = args.directoryStore
                .getSnapshot()
                .entries.find((candidate) => candidate.runtimeRecordId === entry.runtimeRecordId)
              if (!currentEntry || !accountRuntimeCanRequestConnection(currentEntry)) {
                throw new Error('runtime_connection_unavailable')
              }
              if (currentEntry.resourceVersion >= latestEntry.resourceVersion) {
                latestEntry = currentEntry
              }
              let material
              try {
                material = await createAccountRuntimeConnectionIntent(
                  session,
                  entry.runtimeRecordId,
                  latestEntry.resourceVersion,
                  signal
                )
              } catch (failure) {
                if (!(failure instanceof MobileApiError) || failure.status !== 409) {
                  throw failure
                }
                assertCurrent()
                const entries = await loadAllAccountRuntimes(session, undefined, signal)
                assertCurrent()
                const refreshed = entries.find(
                  (candidate) => candidate.runtimeRecordId === entry.runtimeRecordId
                )
                if (!refreshed || !accountRuntimeCanRequestConnection(refreshed)) {
                  throw new Error('runtime_connection_unavailable')
                }
                // Do not publish here: directory reconciliation can abort this connection.
                latestEntry = refreshed
                material = await createAccountRuntimeConnectionIntent(
                  session,
                  entry.runtimeRecordId,
                  refreshed.resourceVersion,
                  signal
                )
              }
              try {
                assertCurrent()
              } catch (failure) {
                disposeHiveAccountRelayMaterial(material)
                throw failure
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
