import AsyncStorage from '@react-native-async-storage/async-storage'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, StyleSheet } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { useOpenMobileAccounts } from '../accounts/use-open-mobile-accounts'
import { getProvenCachedWorktrees } from '../cache/worktree-cache'
import { ActionSheetModal } from '../components/ActionSheetModal'
import { ConfirmModal } from '../components/ConfirmModal'
import { getHostListActionSheetActions } from '../host-list-action-sheet-actions'
import { hostNewWorktreeRoute } from '../host-route-action-state'
import { hostRouteWithNotice } from '../host-route-notice'
import { useResponsiveLayout } from '../layout/responsive-layout'
import { triggerMediumImpact } from '../platform/haptics'
import { useOpenMobileSession } from '../session/use-open-mobile-session'
import type { TaskProvider } from '../tasks/mobile-task-providers'
import { useOpenMobileTasks } from '../tasks/use-open-mobile-tasks'
import { useMobileTheme } from '../theme/mobile-theme-provider'
import {
  useDisconnectHostClient,
  useForceReconnect,
  useForgetHostClient
} from '../transport/client-context'
import { hostEndpointLabel } from '../transport/host-endpoint-label'
import { resolveHomeHostConnectionState } from '../transport/home-host-auto-connect'
import { removeHostAndCloseClient } from '../transport/host-removal-lifecycle'
import { loadHostCatalog } from '../transport/host-store'
import type { HostCatalogEntry, HostProfile } from '../transport/types'
import { useOpenMobileHostEdit } from '../transport/use-open-mobile-host-edit'
import type { HomeWorktreeSummary } from '../worktree/home-worktree-info'
import { isResumeTargetConfirmedMissing, type HomeResumeCard } from '../worktree/home-resume-card'
import { MobileCloudWorkPreview } from './MobileCloudWorkPreview'
import { MobileComputerEmptyState } from './MobileComputerEmptyState'
import { MobileHomeModeTransition } from './MobileHomeModeTransition'
import { MobileHomeHostList } from './MobileHomeHostList'
import { MobileHomeListFooter } from './MobileHomeListFooter'
import { MobileHomeDrawer } from './MobileHomeDrawer'
import { MobileHomeToolbar } from './MobileHomeToolbar'
import {
  loadInitialMobileHomeMode,
  persistMobileHomeMode,
  type MobileHomeMode
} from './mobile-home-mode'
import { useMobileHomeData } from './use-mobile-home-data'

export function MobileHomeScreen() {
  const data = useMobileHomeData()
  const theme = useMobileTheme()
  const insets = useSafeAreaInsets()
  const { isWideLayout, contentMaxWidth } = useResponsiveLayout()
  const openMobileHostEdit = useOpenMobileHostEdit()
  const openMobileTasks = useOpenMobileTasks()
  const openMobileSession = useOpenMobileSession()
  const openMobileAccounts = useOpenMobileAccounts()
  const disconnectHostClient = useDisconnectHostClient()
  const forgetHostClient = useForgetHostClient()
  const forceReconnectHost = useForceReconnect()
  const [actionTarget, setActionTarget] = useState<HostProfile | null>(null)
  const [confirmRemove, setConfirmRemove] = useState<{ id: string; name: string } | null>(null)
  const [homeMode, setHomeMode] = useState<MobileHomeMode | null>(null)
  const [homeModeHydrated, setHomeModeHydrated] = useState(false)
  const [drawerVisible, setDrawerVisible] = useState(false)
  const pendingDrawerActionRef = useRef<(() => void) | null>(null)
  const homeModeHydratedRef = useRef(false)

  useEffect(() => {
    if (homeModeHydratedRef.current) {
      return
    }
    let active = true
    void loadInitialMobileHomeMode(AsyncStorage, data.hostCatalog.length > 0).then((mode) => {
      if (active && !homeModeHydratedRef.current) {
        homeModeHydratedRef.current = true
        setHomeModeHydrated(true)
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

  const closeDrawer = useCallback(() => {
    pendingDrawerActionRef.current = null
    setDrawerVisible(false)
  }, [])

  const closeDrawerAfter = useCallback((action?: () => void) => {
    pendingDrawerActionRef.current = action ?? null
    setDrawerVisible(false)
  }, [])

  const handleDrawerAfterClose = useCallback(() => {
    const action = pendingDrawerActionRef.current
    pendingDrawerActionRef.current = null
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
      if (data.primaryHost) {
        openMobileTasks(data.primaryHost.id, provider)
      }
    },
    [data.primaryHost, openMobileTasks]
  )

  function openHost(host: HostCatalogEntry): void {
    if (host.credentialStatus === 'missing') {
      data.router.push('/pair-scan')
    } else if (host.credentialStatus === 'temporarily-unavailable') {
      void loadHostCatalog()
        .then(data.setHostCatalog)
        .catch(() => Alert.alert('Could not check pairing', 'Please try again.'))
    } else {
      data.router.push(`/h/${host.id}`)
    }
  }

  function openHostActions(host: HostCatalogEntry): void {
    if (host.profile) {
      setActionTarget(host.profile)
    } else {
      setConfirmRemove(host)
    }
  }

  async function handleRemove(): Promise<void> {
    if (!confirmRemove) {
      return
    }
    const host = confirmRemove
    try {
      await removeHostAndCloseClient(host.id, forgetHostClient)
      setConfirmRemove(null)
      data.setHostCatalog(await loadHostCatalog())
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
        hasConnectedComputer={data.connectedHosts.length > 0}
        mode={effectiveHomeMode}
        onChangeMode={changeHomeMode}
        onOpenMenu={() => setDrawerVisible(true)}
        theme={theme}
      />
      <MobileHomeModeTransition
        key={homeModeHydrated ? 'hydrated' : 'boot'}
        mode={effectiveHomeMode}
        renderMode={(mode) =>
          mode === 'cloud' ? (
            <MobileCloudWorkPreview
              bottomInset={insets.bottom}
              onMore={() => setDrawerVisible(true)}
              onNewTask={() => {
                if (data.primaryHost) {
                  openTasks()
                } else {
                  data.router.push('/pair-scan')
                }
              }}
              onOpenProject={() => {
                if (data.primaryHost) {
                  data.router.push(`/h/${data.primaryHost.id}`)
                } else {
                  data.router.push('/pair-scan')
                }
              }}
              onOpenWorkspace={() => {
                if (data.primaryHost) {
                  data.router.push(hostNewWorktreeRoute(data.primaryHost.id))
                } else {
                  data.router.push('/pair-scan')
                }
              }}
              theme={theme}
            />
          ) : data.hostCatalog.length === 0 ? (
            <MobileComputerEmptyState
              bottomInset={insets.bottom}
              maxWidth={isWideLayout ? contentMaxWidth : undefined}
              onEnterCode={() => data.router.push('/pair')}
              onScan={() => data.router.push('/pair-scan')}
              theme={theme}
            />
          ) : (
            <MobileHomeHostList
              autoConnectHostIds={data.autoConnectHostIds}
              bottomInset={insets.bottom}
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
          )
        }
      />
      <MobileHomeDrawer
        canOpenHostActions={data.primaryHost != null}
        onAccount={() => {
          closeDrawerAfter(() => data.router.push('/login'))
        }}
        onAfterClose={handleDrawerAfterClose}
        onClose={closeDrawer}
        onComputers={() => {
          closeDrawerAfter(() => changeHomeMode('computer'))
        }}
        onFeedback={() => {
          closeDrawerAfter(() => data.router.push('/feedback'))
        }}
        onHome={() => {
          closeDrawerAfter(() => changeHomeMode('cloud'))
        }}
        onNewWorkspace={() => {
          const primaryHostId = data.primaryHost?.id
          if (primaryHostId) {
            closeDrawerAfter(() => data.router.push(hostNewWorktreeRoute(primaryHostId)))
          } else {
            closeDrawer()
          }
        }}
        onRecentWork={() => {
          const resumeCard = data.resumeCard
          if (resumeCard) {
            closeDrawerAfter(() => openResume(resumeCard))
          } else {
            closeDrawer()
          }
        }}
        onSettings={() => {
          closeDrawerAfter(() => data.router.push('/settings'))
        }}
        onTasks={() => {
          closeDrawerAfter(openTasks)
        }}
        pairedComputerCount={data.hostCatalog.length}
        theme={theme}
        visible={drawerVisible}
      />
      <ActionSheetModal
        visible={actionTarget != null}
        title={actionTarget?.name}
        message={actionTarget ? hostEndpointLabel(actionTarget.endpoint) : undefined}
        actions={getHostListActionSheetActions({
          host: actionTarget,
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
          onRemove: (host) => setConfirmRemove(host)
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

const styles = StyleSheet.create({
  container: { flex: 1 }
})
