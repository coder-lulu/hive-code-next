import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore
} from 'react'
import { AppState } from 'react-native'
import { useMobileAuthSession } from '../auth/mobile-auth-session'
import { MobileApiError } from '../auth/mobile-sms-client'
import type { MobileSession } from '../auth/mobile-sms-auth'
import { useForgetHostClient, useRefreshHostClient } from '../transport/client-context'
import type { HostCatalogEntry } from '../transport/types'
import {
  loadAllAccountRuntimes,
  loadRuntimePresence,
  loadRuntimeSessions,
  revokeRuntimeSession
} from './account-runtime-directory-client'
import {
  createAccountRuntimeDirectoryOperationState,
  invalidateAccountRuntimeDirectoryOperations,
  runAccountRuntimeDirectoryOperation,
  selectAccountRuntimePresenceBatch
} from './account-runtime-directory-operations'
import { mergeAccountRuntimeCatalog } from './account-runtime-catalog'
import { listAccountRuntimeClients } from './account-runtime-client-registry'
import {
  invalidateAccountRuntimeClients,
  reconcileAccountRuntimeClients
} from './account-runtime-client-reconciliation'
import { AccountRuntimeDirectoryStore } from './account-runtime-directory-store'
import {
  clearAccountRuntimeProfiles,
  replaceAccountRuntimeProfiles
} from './account-runtime-profile-registry'
import {
  accountRuntimeScopeOf,
  mobileSessionMatchesDirectoryScope,
  mobileSessionMatchesOperationScope,
  runCurrentAccountSessionOperation
} from './account-runtime-session-operation'
import type {
  AccountRuntimeDirectoryEntry,
  RuntimeSession
} from './account-runtime-directory-types'
import type { AccountRuntimeDirectoryContextValue } from './account-runtime-directory-context-value'
import { useAccountRuntimeDisplayNameSync } from './use-account-runtime-display-name-sync'
import { useAccountRuntimeCloudProfile } from './use-account-runtime-cloud-profile'
import { forgetAccountRuntimeClientsOnProviderUnmount } from './account-runtime-provider-teardown'

export { forgetAccountRuntimeClientsOnProviderUnmount } from './account-runtime-provider-teardown'

const AccountRuntimeDirectoryContext = createContext<AccountRuntimeDirectoryContextValue | null>(
  null
)

const EMPTY_DIRECTORY_ENTRIES: readonly AccountRuntimeDirectoryEntry[] = []

export function AccountRuntimeDirectoryProvider(props: PropsWithChildren) {
  const auth = useMobileAuthSession()
  const forgetHostClient = useForgetHostClient()
  const refreshHostClient = useRefreshHostClient()
  const storeRef = useRef<AccountRuntimeDirectoryStore | null>(null)
  storeRef.current ??= new AccountRuntimeDirectoryStore()
  const store = storeRef.current
  const operationStateRef = useRef<ReturnType<
    typeof createAccountRuntimeDirectoryOperationState
  > | null>(null)
  operationStateRef.current ??= createAccountRuntimeDirectoryOperationState()
  const operationState = operationStateRef.current
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const sessionRef = useRef<MobileSession | null>(auth.session)
  const previousTransportSessionRef = useRef<MobileSession | null>(auth.session)
  const presenceOffsetRef = useRef(0)
  const presenceSequenceRef = useRef(0)
  sessionRef.current = auth.session
  const scopeMatchesSession = Boolean(
    auth.session &&
    state.scope?.accountId === auth.session.account.accountId &&
    state.scope.authorityId === auth.session.authorityId
  )
  const visibleEntries = scopeMatchesSession ? state.entries : EMPTY_DIRECTORY_ENTRIES
  const visibleState = scopeMatchesSession
    ? state
    : {
        ...state,
        scope: null,
        status: auth.session ? ('loading' as const) : ('idle' as const),
        entries: [],
        loadedAt: null,
        error: null
      }

  const refreshMobileSession = auth.refresh
  const withCurrentSession = useCallback(
    async <T,>(operation: (session: MobileSession) => Promise<T>): Promise<T> => {
      const current = sessionRef.current
      if (!current) {
        throw new Error('mobile_session_required')
      }
      try {
        return await runCurrentAccountSessionOperation(current, () => sessionRef.current, operation)
      } catch (failure) {
        if (!(failure instanceof MobileApiError) || failure.status !== 401) {
          throw failure
        }
        if (!mobileSessionMatchesOperationScope(sessionRef.current, current)) {
          throw new Error('mobile_session_required')
        }
        const refreshed = await refreshMobileSession()
        if (
          !refreshed ||
          refreshed.account.accountId !== current.account.accountId ||
          refreshed.authorityId !== current.authorityId
        ) {
          throw new Error('mobile_session_required')
        }
        return runCurrentAccountSessionOperation(refreshed, () => sessionRef.current, operation)
      }
    },
    [refreshMobileSession]
  )

  const requestDirectoryRefreshRef = useRef<() => void>(() => undefined)
  const { pendingDisplayNames, queueDisplayNameUpdate, reconcileDirectory } =
    useAccountRuntimeDisplayNameSync({
      session: auth.session,
      sessionRef,
      directoryStore: store,
      withCurrentSession,
      requestDirectoryRefreshRef
    })

  const refresh = useCallback(
    (force = true): Promise<void> => {
      const current = sessionRef.current
      if (!current) {
        clearAccountRuntimeProfiles()
        invalidateAccountRuntimeClients(
          listAccountRuntimeClients(),
          forgetHostClient,
          refreshHostClient
        )
        store.clear()
        return Promise.resolve()
      }
      if (AppState.currentState !== 'active') {
        return Promise.resolve()
      }
      if (!force && store.isDirectoryFresh(accountRuntimeScopeOf(current))) {
        return Promise.resolve()
      }
      return runAccountRuntimeDirectoryOperation(
        operationState,
        'refresh',
        async (isCurrent, signal) => {
          const requestedScope = accountRuntimeScopeOf(current)
          const generation = store.activate(requestedScope)
          try {
            const entries = await withCurrentSession((session) =>
              loadAllAccountRuntimes(session, undefined, signal)
            )
            if (
              isCurrent() &&
              AppState.currentState === 'active' &&
              mobileSessionMatchesDirectoryScope(sessionRef.current, requestedScope)
            ) {
              store.complete(generation, entries, Date.now())
              await reconcileDirectory(requestedScope, entries)
            }
          } catch (failure) {
            if (
              isCurrent() &&
              AppState.currentState === 'active' &&
              mobileSessionMatchesDirectoryScope(sessionRef.current, requestedScope)
            ) {
              store.fail(generation, errorMessage(failure))
            }
          }
        }
      )
    },
    [
      forgetHostClient,
      operationState,
      refreshHostClient,
      reconcileDirectory,
      store,
      withCurrentSession
    ]
  )
  requestDirectoryRefreshRef.current = () => void refresh()

  useEffect(() => {
    const current = auth.session
    const previousTransportSession = previousTransportSessionRef.current
    previousTransportSessionRef.current = current
    presenceOffsetRef.current = 0
    invalidateAccountRuntimeDirectoryOperations(operationState)
    if (!current) {
      clearAccountRuntimeProfiles()
      invalidateAccountRuntimeClients(
        listAccountRuntimeClients(),
        forgetHostClient,
        refreshHostClient
      )
      store.clear()
      return
    }
    const previousScope = store.getSnapshot().scope
    if (
      (previousTransportSession &&
        !mobileSessionMatchesOperationScope(current, previousTransportSession)) ||
      (previousScope &&
        (previousScope.accountId !== current.account.accountId ||
          previousScope.authorityId !== current.authorityId))
    ) {
      clearAccountRuntimeProfiles()
      invalidateAccountRuntimeClients(
        listAccountRuntimeClients(),
        forgetHostClient,
        refreshHostClient
      )
    }
    void refresh()
  }, [auth.session, forgetHostClient, operationState, refresh, refreshHostClient, store])

  const updatePresence = useCallback((): Promise<void> => {
    if (AppState.currentState !== 'active') {
      return Promise.resolve()
    }
    return runAccountRuntimeDirectoryOperation(
      operationState,
      'presence',
      async (isCurrent, signal) => {
        // A full directory response already includes presence for every returned Runtime.
        await operationState.flights.refresh
        if (!isCurrent() || AppState.currentState !== 'active') {
          return
        }
        const current = sessionRef.current
        const snapshot = store.getSnapshot()
        if (
          !current ||
          !snapshot.scope ||
          snapshot.entries.length === 0 ||
          !mobileSessionMatchesDirectoryScope(current, snapshot.scope)
        ) {
          return
        }
        const requestedScope = snapshot.scope
        const generation = snapshot.generation
        const sequence = ++presenceSequenceRef.current
        const batch = selectAccountRuntimePresenceBatch(
          store.stalePresenceIds(),
          presenceOffsetRef.current
        )
        presenceOffsetRef.current = batch.nextOffset
        if (batch.runtimeRecordIds.length === 0) {
          return
        }
        try {
          const presence = await withCurrentSession((session) =>
            loadRuntimePresence(session, batch.runtimeRecordIds, signal)
          )
          if (
            isCurrent() &&
            AppState.currentState === 'active' &&
            mobileSessionMatchesDirectoryScope(sessionRef.current, requestedScope)
          ) {
            store.updatePresence(generation, sequence, presence)
          }
        } catch {
          // Keep the last server-observed state; the directory refresh remains retryable.
        }
      }
    )
  }, [operationState, store, withCurrentSession])

  useEffect(() => {
    if (!auth.session) {
      return
    }
    const timer = setInterval(() => {
      void refresh(false)
      void updatePresence()
    }, 30_000)
    return () => clearInterval(timer)
  }, [auth.session, refresh, updatePresence])

  useEffect(() => {
    let previous = AppState.currentState
    const appState = AppState.addEventListener('change', (next) => {
      const resumed = next === 'active' && previous !== 'active'
      previous = next
      if (resumed) {
        void refresh(false)
        void updatePresence()
      } else if (next !== 'active') {
        invalidateAccountRuntimeDirectoryOperations(operationState)
      }
    })
    return () => appState.remove()
  }, [operationState, refresh, updatePresence])

  useEffect(
    () => () => {
      invalidateAccountRuntimeDirectoryOperations(operationState)
      forgetAccountRuntimeClientsOnProviderUnmount(listAccountRuntimeClients(), forgetHostClient)
      clearAccountRuntimeProfiles()
      store.clear()
    },
    [forgetHostClient, operationState, store]
  )

  const createCloudProfile = useAccountRuntimeCloudProfile({
    pendingDisplayNames,
    directoryStore: store,
    sessionRef,
    withCurrentSession
  })

  useEffect(() => {
    if (!scopeMatchesSession) {
      clearAccountRuntimeProfiles()
      return
    }
    const profiles = visibleEntries.flatMap((entry) => {
      const profile = createCloudProfile(entry)
      return profile ? [profile] : []
    })
    replaceAccountRuntimeProfiles(profiles)
    reconcileAccountRuntimeClients(
      visibleEntries,
      listAccountRuntimeClients(),
      forgetHostClient,
      refreshHostClient
    )
  }, [createCloudProfile, forgetHostClient, refreshHostClient, scopeMatchesSession, visibleEntries])

  const mergeCatalog = useCallback(
    (localCatalog: readonly HostCatalogEntry[]) =>
      mergeAccountRuntimeCatalog(
        localCatalog,
        visibleEntries,
        createCloudProfile,
        pendingDisplayNames
      ),
    [createCloudProfile, pendingDisplayNames, visibleEntries]
  )
  const listSessions = useCallback(
    (cursor: string | null = null) =>
      withCurrentSession((current) => loadRuntimeSessions(current, cursor)),
    [withCurrentSession]
  )
  const revokeSession = useCallback(
    (session: RuntimeSession) =>
      withCurrentSession((current) => revokeRuntimeSession(current, session)),
    [withCurrentSession]
  )
  const value = useMemo(
    () => ({
      state: visibleState,
      mergeCatalog,
      refresh,
      listSessions,
      revokeSession,
      pendingDisplayNames,
      queueDisplayNameUpdate
    }),
    [
      listSessions,
      mergeCatalog,
      pendingDisplayNames,
      queueDisplayNameUpdate,
      refresh,
      revokeSession,
      visibleState
    ]
  )

  return (
    <AccountRuntimeDirectoryContext.Provider value={value}>
      {props.children}
    </AccountRuntimeDirectoryContext.Provider>
  )
}

export function useAccountRuntimeDirectory(): AccountRuntimeDirectoryContextValue {
  const context = useContext(AccountRuntimeDirectoryContext)
  if (!context) {
    throw new Error('useAccountRuntimeDirectory requires AccountRuntimeDirectoryProvider')
  }
  return context
}

function errorMessage(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure)
}
