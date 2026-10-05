import { useCallback, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react'
import { useLocalSearchParams } from 'expo-router'
import { Alert } from 'react-native'
import { useOpenMobileAccounts } from '../accounts/use-open-mobile-accounts'
import { getProvenCachedWorktrees } from '../cache/worktree-cache'
import { ActionSheetModal } from '../components/ActionSheetModal'
import { useMobileAuthSession } from '../auth/mobile-auth-session'
import { ConfirmModal } from '../components/ConfirmModal'
import { getHostListActionSheetActions } from '../host-list-action-sheet-actions'
import { hostRouteWithNotice } from '../host-route-notice'
import { useOpenMobileSession } from '../session/use-open-mobile-session'
import { hostStackHostRoute } from '../navigation/host-stack-navigation'
import type { TaskProvider } from '../tasks/mobile-task-providers'
import { useOpenMobileTasks } from '../tasks/use-open-mobile-tasks'
import { hostCatalogEntryHasLocalPairing } from '../runtime-directory/account-runtime-catalog'
import { MobileRuntimeSelector } from '../runtime-directory/MobileRuntimeSelector'
import { hostCatalogTargetsMatch } from '../runtime-directory/host-catalog-target-match'
import { useMobileTheme } from '../theme/mobile-theme-provider'
import {
  useDisconnectHostClient,
  useForceReconnect,
  useForgetHostClient,
  useHostClient
} from '../transport/client-context'
import { hostEndpointLabel } from '../transport/host-endpoint-label'
import { resolveHomeHostConnectionState } from '../transport/home-host-auto-connect'
import { removeHostAndCloseClient } from '../transport/host-removal-lifecycle'
import type { HostCatalogEntry } from '../transport/types'
import { useOpenMobileHostEdit } from '../transport/use-open-mobile-host-edit'
import type { HomeWorktreeSummary } from '../worktree/home-worktree-info'
import { isResumeTargetConfirmedMissing, type HomeResumeCard } from '../worktree/home-resume-card'
import { MobileHomeContext, type MobileHomeContextValue } from './mobile-home-context'
import { MobileHomeDrawer } from './MobileHomeDrawer'
import { useMobileHomeData } from './use-mobile-home-data'
import type { MobileHomeConnectionMethod } from './mobile-home-connection-content'

type HostActionTarget = { host: HostCatalogEntry; scopeRevision: number }

export function MobileHomeProvider({ children }: PropsWithChildren) {
  const data = useMobileHomeData()
  const params = useLocalSearchParams<{ runtimeId?: string }>()
  const theme = useMobileTheme()
  const { session } = useMobileAuthSession()
  const openMobileHostEdit = useOpenMobileHostEdit()
  const openMobileTasks = useOpenMobileTasks()
  const openMobileSession = useOpenMobileSession()
  const openMobileAccounts = useOpenMobileAccounts()
  const disconnectHostClient = useDisconnectHostClient()
  const forgetHostClient = useForgetHostClient()
  const forceReconnectHost = useForceReconnect()
  const [actionTarget, setActionTarget] = useState<HostActionTarget | null>(null)
  const [confirmRemove, setConfirmRemove] = useState<HostActionTarget | null>(null)
  const [drawerVisible, setDrawerVisible] = useState(false)
  const [runtimeSelectorVisible, setRuntimeSelectorVisible] = useState(false)
  const [accountOnlySelector, setAccountOnlySelector] = useState(false)
  const [connectionMethod, setConnectionMethod] = useState<MobileHomeConnectionMethod>('scan')
  const sessionScope = session ? `${session.authorityId}:${session.account.accountId}` : null
  const current = useRef({
    catalog: data.hostCatalog,
    sessionScope,
    scopeRevision: 0,
    confirmRemove
  })
  const scopeRevision =
    current.current.scopeRevision + Number(current.current.sessionScope !== sessionScope)
  current.current = { catalog: data.hostCatalog, sessionScope, scopeRevision, confirmRemove }
  const active = useRef(true)
  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
    }
  }, [])
  const scopeMatches = () => active.current && current.current.scopeRevision === scopeRevision
  function resolveCurrentHost(snapshot: HostCatalogEntry) {
    if (!scopeMatches()) {
      return undefined
    }
    const host = current.current.catalog.find((entry) => entry.id === snapshot.id)
    return hostCatalogTargetsMatch(snapshot, host) ? host : undefined
  }
  function resolveActionTarget(target: HostActionTarget | null) {
    const host =
      target?.scopeRevision === scopeRevision ? resolveCurrentHost(target.host) : undefined
    return host &&
      (hostCatalogEntryHasLocalPairing(host) ||
        (sessionScope && host.accessSources?.includes('account-claimed')))
      ? host
      : undefined
  }
  const validActionTarget = resolveActionTarget(actionTarget)
  const removeTarget = resolveActionTarget(confirmRemove)
  const validRemoveTarget =
    removeTarget && hostCatalogEntryHasLocalPairing(removeTarget) ? removeTarget : undefined
  useEffect(() => {
    if (actionTarget && !validActionTarget) {
      setActionTarget(null)
    }
    if (confirmRemove && !validRemoveTarget) {
      setConfirmRemove(null)
    }
  }, [actionTarget, validActionTarget, confirmRemove, validRemoveTarget])
  useEffect(() => {
    setConnectionMethod(sessionScope ? 'account' : 'scan')
    setRuntimeSelectorVisible(false)
    setActionTarget(null)
    setConfirmRemove(null)
    setDrawerVisible(false)
  }, [sessionScope])
  const openRuntimeSelector = useCallback(
    (accountOnly = false) => {
      if (!scopeMatches()) {
        return
      }
      setAccountOnlySelector(accountOnly)
      setRuntimeSelectorVisible(true)
    },
    [sessionScope]
  )
  const [selectedRuntimeId, setSelectedRuntimeId] = useState<string | null>(() =>
    typeof params.runtimeId === 'string' ? params.runtimeId : null
  )
  const selectedRuntime =
    selectedRuntimeId != null
      ? (data.hostCatalog.find((runtime) => runtime.id === selectedRuntimeId) ?? null)
      : ((data.primaryHost
          ? data.hostCatalog.find((runtime) => runtime.id === data.primaryHost?.id)
          : null) ??
        data.hostCatalog[0] ??
        null)
  const effectiveRuntimeId = selectedRuntime?.id ?? null
  const selectedConnectableRuntimeId = selectedRuntime?.profile ? effectiveRuntimeId : null
  const { client: selectedRuntimeClient, state: selectedRuntimeConnectionState } = useHostClient(
    selectedConnectableRuntimeId ?? undefined
  )
  const selectedRuntimeConnected =
    effectiveRuntimeId != null && selectedRuntimeConnectionState === 'connected'
  const activeConnectedHost = selectedRuntimeConnected ? (selectedRuntime?.profile ?? null) : null
  const selectedResumeCard = data.resumeCard?.hostId === effectiveRuntimeId ? data.resumeCard : null

  const closeDrawer = useCallback(() => {
    setDrawerVisible(false)
  }, [])

  const closeDrawerAfter = useCallback(
    (action?: () => void) => {
      if (!scopeMatches()) {
        return
      }
      setDrawerVisible(false)
      action?.()
    },
    [sessionScope]
  )

  const openResume = useCallback(
    (card: HomeResumeCard) => {
      if (!scopeMatches()) {
        return
      }
      if (
        isResumeTargetConfirmedMissing(
          card,
          getProvenCachedWorktrees(card.hostId) as HomeWorktreeSummary[] | null
        )
      ) {
        data.router.push(hostRouteWithNotice(card.hostId, 'worktree-missing'))
        return
      }
      openMobileSession({
        hostId: card.hostId,
        worktreeId: card.worktree.worktreeId,
        name: card.worktree.displayName || card.worktree.repo
      })
    },
    [data.router, openMobileSession, sessionScope]
  )

  const openTasks = useCallback(
    (provider?: TaskProvider) => {
      if (!scopeMatches()) {
        return
      }
      if (activeConnectedHost) {
        openMobileTasks(activeConnectedHost.id, provider)
        return
      }
      Alert.alert('Runtime 当前不可用', '连接恢复前，任务状态不可验证，也不会切换到其他电脑执行。')
    },
    [activeConnectedHost, openMobileTasks, sessionScope]
  )

  function openHost(snapshot: HostCatalogEntry): void {
    const host = resolveCurrentHost(snapshot)
    if (!host) {
      return
    }
    const liveConnected = data.hostStates[host.id] === 'connected'
    if (host.credentialStatus === 'missing') {
      data.router.push('/pair-scan')
    } else if (host.credentialStatus === 'temporarily-unavailable' && !liveConnected) {
      void data
        .reloadHostCatalog()
        .catch(() => Alert.alert('Could not check pairing', 'Please try again.'))
    } else if (host.credentialStatus === 'cloud-offline' && !liveConnected) {
      Alert.alert(
        'Runtime offline',
        'This Runtime will be available when it reconnects to HiveCloud.'
      )
    } else if (host.credentialStatus === 'cloud-unavailable' && !liveConnected) {
      Alert.alert(
        'Cloud connection unavailable',
        'This Runtime is not advertising a mobile Relay route yet.'
      )
    } else {
      setSelectedRuntimeId(host.id)
      data.router.push(hostStackHostRoute(host.id))
    }
  }

  function openHostActions(snapshot: HostCatalogEntry): void {
    const host = resolveCurrentHost(snapshot)
    if (!host) {
      return
    }
    if (host.profile || (sessionScope && host.accessSources?.includes('account-claimed'))) {
      setActionTarget({ host, scopeRevision })
    } else if (hostCatalogEntryHasLocalPairing(host)) {
      setConfirmRemove({ host, scopeRevision })
    }
  }

  async function handleRemove(): Promise<void> {
    const host = resolveActionTarget(confirmRemove)
    if (!host || !hostCatalogEntryHasLocalPairing(host)) {
      return
    }
    try {
      await removeHostAndCloseClient(host.id, forgetHostClient)
      if (!scopeMatches()) {
        return
      }
      if (current.current.confirmRemove === confirmRemove) {
        setConfirmRemove(null)
      }
      await data.reloadHostCatalog()
    } catch {
      if (current.current.confirmRemove !== confirmRemove || !resolveActionTarget(confirmRemove)) {
        return
      }
      Alert.alert('Could not remove host', 'Please try again.')
    }
  }

  function performHostAction(hostId: string, action: (id: string) => void) {
    if (actionTarget?.host.id === hostId && resolveActionTarget(actionTarget)) {
      action(hostId)
    }
  }

  function selectRuntime(runtimeId: string) {
    const host = current.current.catalog.find((entry) => entry.id === runtimeId)
    if (scopeMatches() && host?.credentialStatus === 'ready' && host.profile) {
      setSelectedRuntimeId(runtimeId)
    }
  }

  const context = useMemo<MobileHomeContextValue>(
    () => ({
      data,
      selectedRuntime,
      selectedRuntimeClient,
      activeConnectedHost,
      connectionMethod,
      setConnectionMethod,
      openRuntimeSelector,
      openMenu: () => setDrawerVisible(true),
      selectRuntime,
      openHost,
      openHostActions,
      openResume,
      openTasks,
      openAccounts: openMobileAccounts
    }),
    [
      data,
      selectedRuntime,
      selectedRuntimeClient,
      activeConnectedHost,
      connectionMethod,
      openRuntimeSelector,
      selectRuntime,
      openHost,
      openHostActions,
      openResume,
      openTasks,
      openMobileAccounts
    ]
  )

  return (
    <MobileHomeContext.Provider value={context}>
      {children}
      <MobileHomeDrawer
        canOpenHostActions={activeConnectedHost != null}
        onAccount={() => closeDrawerAfter(() => data.router.push(session ? '/account' : '/login'))}
        onApiQuota={() =>
          closeDrawerAfter(() => data.router.push(session ? '/ai-account' : '/login'))
        }
        onClose={closeDrawer}
        onManageDevices={() => closeDrawerAfter(() => data.router.push('/devices'))}
        onFeedback={() => closeDrawerAfter(() => data.router.push('/feedback'))}
        onRecentWork={() => {
          const resumeCard = selectedResumeCard
          if (resumeCard) {
            closeDrawerAfter(() => openResume(resumeCard))
          } else {
            closeDrawer()
          }
        }}
        onSettings={() => closeDrawerAfter(() => data.router.push('/settings'))}
        onTasks={() => closeDrawerAfter(openTasks)}
        pairedComputerCount={data.hostCatalog.length}
        theme={theme}
        visible={drawerVisible}
      />
      <MobileRuntimeSelector
        key={sessionScope ?? 'signed-out'}
        accountOnly={accountOnlySelector}
        catalog={
          accountOnlySelector
            ? data.hostCatalog.filter((host) => host.accessSources?.includes('account-claimed'))
            : data.hostCatalog
        }
        connectionStates={data.hostStates}
        onClose={() => setRuntimeSelectorVisible(false)}
        onPair={() => data.router.push('/pair-scan')}
        onClaim={() => data.router.push('/claim-computer')}
        onSelect={selectRuntime}
        selectedId={effectiveRuntimeId}
        theme={theme}
        visible={runtimeSelectorVisible}
      />
      <ActionSheetModal
        visible={validActionTarget != null}
        title={validActionTarget?.name}
        message={
          validActionTarget?.accessSources?.includes('account-claimed')
            ? '管理账号运行环境与云端别名'
            : validActionTarget
              ? hostEndpointLabel(validActionTarget.endpoint)
              : undefined
        }
        actions={getHostListActionSheetActions({
          host: validActionTarget ?? null,
          state: actionTarget
            ? resolveHomeHostConnectionState(
                actionTarget.host.id,
                data.hostStates[actionTarget.host.id],
                data.autoConnectHostIds
              )
            : 'disconnected',
          hasEverConnected: actionTarget
            ? (data.hostLastConnected[actionTarget.host.id] ?? null) != null
            : false,
          onDismiss: () => {
            if (scopeMatches()) {
              setActionTarget(null)
            }
          },
          onReconnect: forceReconnectHost
            ? (hostId) => performHostAction(hostId, (id) => void forceReconnectHost(id))
            : undefined,
          onDisconnect: (hostId) => performHostAction(hostId, disconnectHostClient),
          onDiagnostics: (hostId) =>
            performHostAction(hostId, (id) =>
              data.router.push({ pathname: '/connection-log', params: { hostId: id } })
            ),
          onEdit: (hostId) => performHostAction(hostId, openMobileHostEdit),
          onSessions: (hostId) =>
            performHostAction(hostId, () => {
              const runtimeRecordId = actionTarget?.host.runtimeRecordId
              if (runtimeRecordId) {
                data.router.push({ pathname: '/runtime-sessions', params: { runtimeRecordId } })
              }
            }),
          onRemove: () => {
            const host = resolveActionTarget(actionTarget)
            if (host && hostCatalogEntryHasLocalPairing(host)) {
              setConfirmRemove({ host, scopeRevision })
            }
          }
        })}
        onClose={() => setActionTarget(null)}
      />
      <ConfirmModal
        visible={validRemoveTarget != null}
        title="移除本地配对"
        message={`从这台手机移除“${validRemoveTarget?.name}”的本地配对？此操作不会解除云端认领。`}
        confirmLabel="移除"
        destructive
        onConfirm={() => void handleRemove()}
        onCancel={() => setConfirmRemove(null)}
      />
    </MobileHomeContext.Provider>
  )
}
