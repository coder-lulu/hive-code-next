import AsyncStorage from '@react-native-async-storage/async-storage'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { useOpenMobileAccounts } from '../accounts/use-open-mobile-accounts'
import { getProvenCachedWorktrees } from '../cache/worktree-cache'
import { ActionSheetModal } from '../components/ActionSheetModal'
import {
  MobilePrimaryNavigation,
  type MobilePrimaryDestination
} from '../components/MobilePrimaryNavigation'
import { useMobileAuthSession } from '../auth/mobile-auth-session'
import { ConfirmModal } from '../components/ConfirmModal'
import { getHostListActionSheetActions } from '../host-list-action-sheet-actions'
import { hostNewWorktreeRoute } from '../host-route-action-state'
import { hostRouteWithNotice } from '../host-route-notice'
import { useResponsiveLayout } from '../layout/responsive-layout'
import { triggerMediumImpact } from '../platform/haptics'
import { useOpenMobileSession } from '../session/use-open-mobile-session'
import { floatingWorkspaceSessionPath } from '../session/floating-workspace'
import type { TaskProvider } from '../tasks/mobile-task-providers'
import { useOpenMobileTasks } from '../tasks/use-open-mobile-tasks'
import { hostCatalogEntryHasLocalPairing } from '../runtime-directory/account-runtime-catalog'
import { MobileRuntimeSelector } from '../runtime-directory/MobileRuntimeSelector'
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
import { MobileCloudWorkPreview } from './MobileCloudWorkPreview'
import { MobileComputerEmptyState } from './MobileComputerEmptyState'
import { MobileHomeHostList } from './MobileHomeHostList'
import { MobileHomeListFooter } from './MobileHomeListFooter'
import { MobileHomeDrawer } from './MobileHomeDrawer'
import { MobileHomeToolbar } from './MobileHomeToolbar'
import { mobileHomeScreenStyles as styles } from './mobile-home-screen-styles'
import {
  loadInitialMobileHomeMode,
  persistMobileHomeMode,
  type MobileHomeMode
} from './mobile-home-mode'
import { useMobileHomeData } from './use-mobile-home-data'

export function MobileHomeScreen() {
  const data = useMobileHomeData()
  const theme = useMobileTheme()
  const { session } = useMobileAuthSession()
  const insets = useSafeAreaInsets()
  const { isWideLayout, contentMaxWidth } = useResponsiveLayout()
  const openMobileHostEdit = useOpenMobileHostEdit()
  const openMobileTasks = useOpenMobileTasks()
  const openMobileSession = useOpenMobileSession()
  const openMobileAccounts = useOpenMobileAccounts()
  const disconnectHostClient = useDisconnectHostClient()
  const forgetHostClient = useForgetHostClient()
  const forceReconnectHost = useForceReconnect()
  const [actionTarget, setActionTarget] = useState<HostCatalogEntry | null>(null)
  const [confirmRemove, setConfirmRemove] = useState<HostCatalogEntry | null>(null)
  const [homeMode, setHomeMode] = useState<MobileHomeMode | null>(null)
  const [drawerVisible, setDrawerVisible] = useState(false)
  const [runtimeSelectorVisible, setRuntimeSelectorVisible] = useState(false)
  const [selectedRuntimeId, setSelectedRuntimeId] = useState<string | null>(null)
  const homeModeHydratedRef = useRef(false)

  useEffect(() => {
    if (homeModeHydratedRef.current) {
      return
    }
    let active = true
    void loadInitialMobileHomeMode(AsyncStorage, data.hostCatalog.length > 0).then((mode) => {
      if (active && !homeModeHydratedRef.current) {
        homeModeHydratedRef.current = true
        setHomeMode(mode)
      }
    })
    return () => {
      active = false
    }
  }, [data.hostCatalog.length])

  const changeHomeMode = useCallback((mode: MobileHomeMode) => {
    homeModeHydratedRef.current = true
    setHomeMode(mode)
    void persistMobileHomeMode(AsyncStorage, mode).catch(() => {})
  }, [])

  const effectiveHomeMode = homeMode ?? 'cloud'
  const selectedRuntime =
    data.hostCatalog.find((runtime) => runtime.id === selectedRuntimeId) ??
    (data.primaryHost
      ? data.hostCatalog.find((runtime) => runtime.id === data.primaryHost?.id)
      : null) ??
    data.hostCatalog[0] ??
    null
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

  const closeDrawerAfter = useCallback((action?: () => void) => {
    setDrawerVisible(false)
    action?.()
  }, [])

  const openResume = useCallback(
    (card: HomeResumeCard) => {
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
    [data.router, openMobileSession]
  )

  const openTasks = useCallback(
    (provider?: TaskProvider) => {
      if (activeConnectedHost) {
        openMobileTasks(activeConnectedHost.id, provider)
        return
      }
      Alert.alert('Runtime 当前不可用', '连接恢复前，任务状态不可验证，也不会切换到其他电脑执行。')
    },
    [activeConnectedHost, openMobileTasks]
  )

  const openSelectedWorkspace = useCallback(() => {
    if (activeConnectedHost) {
      data.router.push(`/h/${activeConnectedHost.id}`)
      return
    }
    if (selectedRuntime) {
      Alert.alert('Runtime 当前不可用', '连接恢复前，工作区内容不可验证。')
      return
    }
    data.router.push('/pair-scan')
  }, [activeConnectedHost, data.router, selectedRuntime])

  const selectPrimaryDestination = useCallback(
    (destination: MobilePrimaryDestination) => {
      if (destination === 'tasks') {
        return
      }
      if (destination === 'workspace') {
        openSelectedWorkspace()
        return
      }
      const unavailable = {
        agents: ['智能体', 'HiveAgent 角色目录的数据契约尚未接入，暂不展示示例角色。'],
        library: ['资料库', '资料库聚合入口正在接入当前 Runtime 的会话与文件。'],
        automation: ['自动化', '移动端自动化控制面尚未接入当前 Runtime。']
      } as const
      const [title, message] = unavailable[destination]
      Alert.alert(title, message)
    },
    [openSelectedWorkspace]
  )

  function openHost(host: HostCatalogEntry): void {
    if (host.credentialStatus === 'missing') {
      data.router.push('/pair-scan')
    } else if (host.credentialStatus === 'temporarily-unavailable') {
      void data
        .reloadHostCatalog()
        .catch(() => Alert.alert('Could not check pairing', 'Please try again.'))
    } else if (host.credentialStatus === 'cloud-offline') {
      Alert.alert(
        'Runtime offline',
        'This Runtime will be available when it reconnects to HiveCloud.'
      )
    } else if (host.credentialStatus === 'cloud-unavailable') {
      Alert.alert(
        'Cloud connection unavailable',
        'This Runtime is not advertising a mobile Relay route yet.'
      )
    } else {
      data.router.push(`/h/${host.id}`)
    }
  }

  function openHostActions(host: HostCatalogEntry): void {
    if (!hostCatalogEntryHasLocalPairing(host)) {
      Alert.alert(
        'Account Runtime',
        'Manage this Runtime and its sessions from your HiveCloud account.'
      )
      return
    }
    if (host.profile) {
      setActionTarget(host)
    } else {
      setConfirmRemove(host)
    }
  }

  async function handleRemove(): Promise<void> {
    if (!confirmRemove || !hostCatalogEntryHasLocalPairing(confirmRemove)) {
      setConfirmRemove(null)
      return
    }
    const host = confirmRemove
    try {
      await removeHostAndCloseClient(host.id, forgetHostClient)
      setConfirmRemove(null)
      await data.reloadHostCatalog()
    } catch {
      setConfirmRemove(host)
      Alert.alert('Could not remove host', 'Please try again.')
    }
  }

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: theme.color.bg.canvas }]}
      edges={['top']}
    >
      <MobileHomeToolbar
        onOpenMenu={() => setDrawerVisible(true)}
        onOpenRuntimeSelector={() => setRuntimeSelectorVisible(true)}
        runtimeName={selectedRuntime?.name ?? null}
        theme={theme}
      />
      {effectiveHomeMode === 'cloud' ? (
        <MobileCloudWorkPreview
          client={selectedRuntimeClient}
          connectionState={selectedRuntimeConnectionState}
          onTerminalCreated={(runtimeId) =>
            data.router.push(floatingWorkspaceSessionPath(runtimeId))
          }
          runtimeId={effectiveRuntimeId}
          theme={theme}
        />
      ) : data.hostCatalog.length === 0 ? (
        <MobileComputerEmptyState
          bottomInset={0}
          maxWidth={isWideLayout ? contentMaxWidth : undefined}
          onEnterCode={() => data.router.push('/pair')}
          onScan={() => data.router.push('/pair-scan')}
          theme={theme}
        />
      ) : (
        <MobileHomeHostList
          autoConnectHostIds={data.autoConnectHostIds}
          bottomInset={0}
          contentMaxWidth={contentMaxWidth}
          footer={
            <MobileHomeListFooter
              accountsHosts={data.accountsHosts}
              connectedHosts={data.connectedHosts}
              primaryHost={data.primaryHost}
              primaryTaskProviders={data.primaryTaskProviders}
              resumeCard={data.resumeCard}
              onCreateWorkspace={(hostId) => data.router.push(hostNewWorktreeRoute(hostId))}
              onOpenAccounts={openMobileAccounts}
              onOpenResume={openResume}
              onOpenTasks={openTasks}
              onPairDesktop={() => data.router.push('/pair-scan')}
            />
          }
          hostAttempts={data.hostAttempts}
          hostLastConnected={data.hostLastConnected}
          hostPairingRejected={data.hostPairingRejected}
          hostSignedOut={data.hostSignedOut}
          hostPaths={data.hostPaths}
          hostPendingPaths={data.hostPendingPaths}
          hosts={data.sortedHostCatalog}
          hostStates={data.hostStates}
          isWideLayout={isWideLayout}
          stats={data.stats}
          worktreeInfo={data.worktreeInfo}
          onOpen={openHost}
          onLongPress={(host) => {
            triggerMediumImpact()
            openHostActions(host)
          }}
          onOpenActions={openHostActions}
        />
      )}
      <MobilePrimaryNavigation
        active={effectiveHomeMode === 'cloud' ? 'tasks' : 'workspace'}
        bottomInset={insets.bottom}
        onSelect={selectPrimaryDestination}
        theme={theme}
      />
      <MobileHomeDrawer
        canOpenHostActions={activeConnectedHost != null}
        onAccount={() => closeDrawerAfter(() => data.router.push(session ? '/account' : '/login'))}
        onClose={closeDrawer}
        onComputers={() => closeDrawerAfter(() => changeHomeMode('computer'))}
        onFeedback={() => closeDrawerAfter(() => data.router.push('/feedback'))}
        onHome={() => closeDrawerAfter(() => changeHomeMode('cloud'))}
        onNewWorkspace={() => {
          const activeHostId = activeConnectedHost?.id
          if (activeHostId) {
            closeDrawerAfter(() => data.router.push(hostNewWorktreeRoute(activeHostId)))
          } else {
            closeDrawer()
          }
        }}
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
        catalog={data.hostCatalog}
        connectionStates={data.hostStates}
        onClose={() => setRuntimeSelectorVisible(false)}
        onPair={() => data.router.push('/pair-scan')}
        onSelect={setSelectedRuntimeId}
        selectedId={effectiveRuntimeId}
        theme={theme}
        visible={runtimeSelectorVisible}
      />
      <ActionSheetModal
        visible={actionTarget != null}
        title={actionTarget?.name}
        message={actionTarget ? hostEndpointLabel(actionTarget.endpoint) : undefined}
        actions={getHostListActionSheetActions({
          host: actionTarget?.profile ?? null,
          state: actionTarget
            ? resolveHomeHostConnectionState(
                actionTarget.id,
                data.hostStates[actionTarget.id],
                data.autoConnectHostIds
              )
            : 'disconnected',
          hasEverConnected: actionTarget
            ? (data.hostLastConnected[actionTarget.id] ?? null) != null
            : false,
          onDismiss: () => setActionTarget(null),
          onReconnect: (hostId) => void forceReconnectHost(hostId),
          onDisconnect: disconnectHostClient,
          onDiagnostics: (hostId) =>
            data.router.push({ pathname: '/connection-log', params: { hostId } }),
          onEdit: openMobileHostEdit,
          onRemove: () => setConfirmRemove(actionTarget)
        })}
        onClose={() => setActionTarget(null)}
      />
      <ConfirmModal
        visible={confirmRemove != null}
        title="Remove Host"
        message={`Remove "${confirmRemove?.name}"? You can re-pair later.`}
        confirmLabel="Remove"
        destructive
        onConfirm={() => void handleRemove()}
        onCancel={() => setConfirmRemove(null)}
      />
    </SafeAreaView>
  )
}
