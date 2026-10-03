import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react'
import { AppState } from 'react-native'
import type { MobileSession } from '../auth/mobile-sms-auth'
import { subscribeConnectionRevivalTriggers } from '../transport/connection-revival-triggers'
import {
  accountRuntimeScopeOf,
  mobileSessionMatchesDirectoryScope,
  mobileSessionMatchesOperationScope
} from './account-runtime-session-operation'
import { AccountRuntimeDisplayNamePendingStore } from './account-runtime-display-name-pending'
import { retryPendingRuntimeDisplayNames } from './account-runtime-display-name-retry'
import {
  loadAccountRuntime,
  updateAccountRuntimeDisplayName
} from './account-runtime-display-name-client'
import type { AccountRuntimeDirectoryStore } from './account-runtime-directory-store'
import type { AccountRuntimeDisplayNameQueueRequest } from './account-runtime-directory-context-value'
import type {
  AccountRuntimeDirectoryEntry,
  AccountRuntimeDirectoryScope
} from './account-runtime-directory-types'

type WithCurrentSession = <T>(operation: (session: MobileSession) => Promise<T>) => Promise<T>

type PendingDisplayNameOverlay = Readonly<{
  sessionKey: string | null
  names: ReadonlyMap<string, string | null>
}>

const EMPTY_PENDING_DISPLAY_NAMES: ReadonlyMap<string, string | null> = new Map()

export function useAccountRuntimeDisplayNameSync(args: {
  session: MobileSession | null
  sessionRef: MutableRefObject<MobileSession | null>
  directoryStore: AccountRuntimeDirectoryStore
  withCurrentSession: WithCurrentSession
  requestDirectoryRefreshRef: MutableRefObject<() => void>
}) {
  const pendingStoreRef = useRef<AccountRuntimeDisplayNamePendingStore | null>(null)
  pendingStoreRef.current ??= new AccountRuntimeDisplayNamePendingStore()
  const pendingStore = pendingStoreRef.current
  const [pendingOverlay, setPendingOverlay] = useState<PendingDisplayNameOverlay>(() => ({
    sessionKey: null,
    names: EMPTY_PENDING_DISPLAY_NAMES
  }))
  const currentSessionKey = pendingDisplayNameSessionKey(args.session)
  const pendingDisplayNames =
    pendingOverlay.sessionKey === currentSessionKey
      ? pendingOverlay.names
      : EMPTY_PENDING_DISPLAY_NAMES

  const reload = useCallback(
    async (
      scope = args.directoryStore.getSnapshot().scope,
      requestedSession = args.sessionRef.current
    ): Promise<void> => {
      if (
        !scope ||
        !requestedSession ||
        !mobileSessionMatchesDirectoryScope(requestedSession, scope) ||
        !mobileSessionMatchesOperationScope(args.sessionRef.current, requestedSession)
      ) {
        return
      }
      const tasks = await pendingStore.loadScope(scope)
      if (mobileSessionMatchesOperationScope(args.sessionRef.current, requestedSession)) {
        setPendingOverlay({
          sessionKey: pendingDisplayNameSessionKey(requestedSession),
          names: new Map(tasks.map((task) => [task.runtimeRecordId, task.desiredName]))
        })
      }
    },
    [args.directoryStore, args.sessionRef, pendingStore]
  )

  const retry = useCallback(async (): Promise<void> => {
    const current = args.sessionRef.current
    if (!current || AppState.currentState !== 'active') {
      return
    }
    const scope = accountRuntimeScopeOf(current)
    const result = await retryPendingRuntimeDisplayNames({
      store: pendingStore,
      scope,
      currentScope: () => {
        const session = args.sessionRef.current
        return session ? accountRuntimeScopeOf(session) : null
      },
      patch: (runtimeRecordId, desiredName, expectedVersion) =>
        args.withCurrentSession((session) =>
          updateAccountRuntimeDisplayName(session, runtimeRecordId, desiredName, expectedVersion)
        ),
      refetch: (runtimeRecordId) =>
        args.withCurrentSession((session) => loadAccountRuntime(session, runtimeRecordId))
    })
    await reload(scope, current)
    if (result.changed || result.directoryRefreshRequired) {
      args.requestDirectoryRefreshRef.current()
    }
  }, [
    args.requestDirectoryRefreshRef,
    args.sessionRef,
    args.withCurrentSession,
    pendingStore,
    reload
  ])

  const queueDisplayNameUpdate = useCallback(
    async (request: AccountRuntimeDisplayNameQueueRequest): Promise<void> => {
      const current = args.sessionRef.current
      const snapshot = args.directoryStore.getSnapshot()
      if (
        !current ||
        !snapshot.scope ||
        !mobileSessionMatchesDirectoryScope(current, snapshot.scope)
      ) {
        throw new Error('mobile_session_required')
      }
      if (
        snapshot.scope.authorityId !== request.expectedScope.authorityId ||
        snapshot.scope.accountId !== request.expectedScope.accountId
      ) {
        throw new Error('runtime_display_name_target_stale')
      }
      const entry = snapshot.entries.find(
        (candidate) => candidate.runtimeRecordId === request.runtimeRecordId
      )
      if (
        !entry ||
        entry.cloudDisplayNameVersion == null ||
        entry.resourceVersion !== request.expectedResourceVersion ||
        entry.cloudDisplayNameVersion !== request.expectedCloudDisplayNameVersion
      ) {
        throw new Error('runtime_display_name_unavailable')
      }
      const task = await pendingStore.enqueue({
        scope: snapshot.scope,
        runtimeRecordId: request.runtimeRecordId,
        desiredName: request.desiredName,
        expectedCloudDisplayNameVersion: request.expectedCloudDisplayNameVersion,
        expectedResourceVersion: request.expectedResourceVersion
      })
      if (mobileSessionMatchesOperationScope(args.sessionRef.current, current)) {
        const sessionKey = pendingDisplayNameSessionKey(current)
        setPendingOverlay((currentOverlay) => {
          const next = new Map(
            currentOverlay.sessionKey === sessionKey
              ? currentOverlay.names
              : EMPTY_PENDING_DISPLAY_NAMES
          )
          next.set(task.runtimeRecordId, task.desiredName)
          return { sessionKey, names: next }
        })
        void retry().catch(() => undefined)
      }
    },
    [args.directoryStore, args.sessionRef, pendingStore, retry]
  )

  const reconcileDirectory = useCallback(
    async (
      scope: AccountRuntimeDirectoryScope,
      entries: readonly AccountRuntimeDirectoryEntry[]
    ): Promise<void> => {
      await pendingStore.reconcileDirectory(scope, entries).catch(() => undefined)
      await reload(scope).catch(() => undefined)
      void retry().catch(() => undefined)
    },
    [pendingStore, reload, retry]
  )

  useEffect(() => {
    if (!args.session) {
      setPendingOverlay({ sessionKey: null, names: EMPTY_PENDING_DISPLAY_NAMES })
      return
    }
    const requestedSession = args.session
    const sessionKey = pendingDisplayNameSessionKey(requestedSession)
    setPendingOverlay((current) =>
      current.sessionKey === sessionKey
        ? current
        : { sessionKey, names: EMPTY_PENDING_DISPLAY_NAMES }
    )
    const scope = accountRuntimeScopeOf(args.session)
    void reload(scope, requestedSession)
      .then(retry)
      .catch(() => undefined)
  }, [args.session, reload, retry])

  useEffect(
    () => subscribeConnectionRevivalTriggers(() => void retry().catch(() => undefined)),
    [retry]
  )

  return {
    pendingDisplayNames,
    queueDisplayNameUpdate,
    reconcileDirectory,
    clearVisible: () =>
      setPendingOverlay({
        sessionKey: currentSessionKey,
        names: EMPTY_PENDING_DISPLAY_NAMES
      })
  }
}

function pendingDisplayNameSessionKey(session: MobileSession | null): string | null {
  return session
    ? `${session.authorityId}\u0000${session.account.accountId}\u0000${session.sessionExpiresAt}`
    : null
}
