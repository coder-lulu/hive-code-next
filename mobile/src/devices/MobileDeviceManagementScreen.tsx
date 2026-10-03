import { useEffect, useMemo, useRef, useState } from 'react'
import { Activity, PowerOff, RefreshCw } from 'lucide-react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useMobileAuthSession } from '../auth/mobile-auth-session'
import { ActionSheetModal } from '../components/ActionSheetModal'
import { useResponsiveLayout } from '../layout/responsive-layout'
import { MobileHomeToolbar } from '../home/MobileHomeToolbar'
import { useMobileHomeContext } from '../home/mobile-home-context'
import { useAccountRuntimeDirectory } from '../runtime-directory/account-runtime-directory-provider'
import { hostCatalogEntryHasLocalPairing } from '../runtime-directory/account-runtime-catalog'
import { useMobileTheme } from '../theme/mobile-theme-provider'
import { useDisconnectHostClient, useForceReconnect } from '../transport/client-context'
import type { HostCatalogEntry } from '../transport/types'
import { MobileDeviceAddMenu, MobileDeviceHelpSheet } from './MobileDeviceMenus'
import { MobileDevicesScreen } from './MobileDevicesScreen'
import { projectMobileDevices } from './mobile-devices-model'
import { useMobileDeviceOperations } from './use-mobile-device-operations'

export function MobileDeviceManagementScreen() {
  const { data, selectedRuntime, openHostActions } = useMobileHomeContext()
  const theme = useMobileTheme()
  const { contentMaxWidth } = useResponsiveLayout()
  const { hydrated, session } = useMobileAuthSession()
  const directory = useAccountRuntimeDirectory()
  const forceReconnect = useForceReconnect()
  const disconnect = useDisconnectHostClient()
  const [addVisible, setAddVisible] = useState(false)
  const [helpVisible, setHelpVisible] = useState(false)
  const [accountTargetId, setAccountTargetId] = useState<string | null>(null)
  const sessionScope = session ? `${session.authorityId}:${session.account.accountId}` : null
  const currentScope = useRef(sessionScope)
  currentScope.current = sessionScope
  const active = useRef(true)
  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
    }
  }, [])
  useEffect(() => {
    setAccountTargetId(null)
    setAddVisible(false)
  }, [sessionScope])
  const pair = () => data.router.push('/pair-scan')
  const lastPresence = useMemo(
    () =>
      Object.fromEntries(
        directory.state.entries.map((entry) => [
          entry.runtimeRecordId,
          entry.lastHeartbeatAt ? Date.parse(entry.lastHeartbeatAt) : null
        ])
      ),
    [directory.state.entries]
  )
  const devices = useMemo(
    () =>
      projectMobileDevices({
        catalog: data.sortedHostCatalog,
        states: data.hostStates,
        selectedId: selectedRuntime?.id ?? null,
        autoConnectHostIds: data.autoConnectHostIds,
        attempts: data.hostAttempts,
        lastConnected: data.hostLastConnected,
        pendingPaths: data.hostPendingPaths,
        pairingRejected: data.hostPairingRejected,
        signedOut: data.hostSignedOut,
        lastPresence
      }),
    [
      data.sortedHostCatalog,
      data.hostStates,
      selectedRuntime?.id,
      data.autoConnectHostIds,
      data.hostAttempts,
      data.hostLastConnected,
      data.hostPendingPaths,
      data.hostPairingRejected,
      data.hostSignedOut,
      lastPresence
    ]
  )
  const currentDevices = useRef(devices)
  currentDevices.current = devices
  const currentDevice = (id: string) =>
    active.current && currentScope.current === sessionScope
      ? currentDevices.current.find((device) => device.host.id === id)
      : undefined
  const accountTarget = devices.find((device) => device.host.id === accountTargetId)?.host ?? null
  useEffect(() => {
    if (accountTargetId && !accountTarget) {
      setAccountTargetId(null)
    }
  }, [accountTargetId, accountTarget])
  const operations = useMobileDeviceOperations({
    scope: sessionScope,
    reloadCatalog: data.reloadHostCatalog,
    refreshDirectory: directory.refresh,
    forceReconnect,
    pair
  })
  const retry = (host: HostCatalogEntry) => {
    const device = currentDevice(host.id)
    if (device) {
      void operations.retry(device.host, device.requiresPairing)
    }
  }
  const details = (host: HostCatalogEntry) => {
    if (currentDevice(host.id)) {
      data.router.push({ pathname: '/connection-log', params: { hostId: host.id } })
    }
  }
  const syncing =
    operations.refreshing ||
    directory.state.status === 'loading' ||
    directory.state.status === 'refreshing'
  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: theme.color.bg.canvas }}
      edges={['top', 'bottom']}
    >
      <MobileHomeToolbar
        theme={theme}
        onBack={() => (data.router.canGoBack() ? data.router.back() : data.router.replace('/'))}
        onRefresh={() => void operations.refresh()}
        refreshing={syncing}
      />
      <MobileDevicesScreen
        devices={devices}
        theme={theme}
        contentMaxWidth={contentMaxWidth}
        paths={data.hostPaths}
        pendingId={operations.pendingId}
        loading={!data.hostCatalogLoaded || syncing}
        error={operations.error ?? data.hostCatalogError ?? directory.state.error}
        onAdd={() => setAddVisible(true)}
        onHelp={() => setHelpVisible(true)}
        onRefresh={() => void operations.refresh()}
        onDetails={details}
        onRetry={retry}
        onActions={(host) =>
          hostCatalogEntryHasLocalPairing(host)
            ? openHostActions(host)
            : setAccountTargetId(host.id)
        }
      />
      <MobileDeviceAddMenu
        visible={addVisible}
        hydrated={hydrated}
        signedIn={session != null}
        onClose={() => setAddVisible(false)}
        onPair={pair}
        onAccount={() => {
          if (active.current && currentScope.current === sessionScope) {
            data.router.push(session ? '/claim-computer' : '/login')
          }
        }}
      />
      <MobileDeviceHelpSheet
        visible={helpVisible}
        onClose={() => setHelpVisible(false)}
        theme={theme}
      />
      <ActionSheetModal
        visible={accountTarget != null}
        title={accountTarget?.name}
        onClose={() => setAccountTargetId(null)}
        actions={
          accountTarget
            ? [
                {
                  label: '重试连接',
                  icon: RefreshCw,
                  closeBeforePress: true,
                  onPress: () => retry(accountTarget)
                },
                ...(devices.some(
                  (device) => device.host.id === accountTarget.id && device.connected
                )
                  ? [
                      {
                        label: '断开连接',
                        icon: PowerOff,
                        closeBeforePress: true,
                        onPress: () => {
                          if (currentDevice(accountTarget.id)?.connected) {
                            disconnect(accountTarget.id)
                          }
                        }
                      }
                    ]
                  : []),
                {
                  label: '连接详情',
                  icon: Activity,
                  closeBeforePress: true,
                  onPress: () => details(accountTarget)
                }
              ]
            : []
        }
      />
    </SafeAreaView>
  )
}
