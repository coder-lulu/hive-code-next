import { View } from 'react-native'
import { useMobileAuthSession } from '../auth/mobile-auth-session'
import { hostNewWorktreeRoute } from '../host-route-action-state'
import { useResponsiveLayout } from '../layout/responsive-layout'
import { triggerMediumImpact } from '../platform/haptics'
import { hostCatalogEntryHasLocalPairing } from '../runtime-directory/account-runtime-catalog'
import { MobileHomeEmptyState } from './MobileHomeEmptyState'
import { MobileHomeHostList } from './MobileHomeHostList'
import { MobileHomeListFooter } from './MobileHomeListFooter'
import { useMobileHomeContext } from './mobile-home-context'

export function MobileHomeComputerList() {
  const {
    data,
    activeConnectedHost,
    selectedRuntime,
    connectionMethod,
    setConnectionMethod,
    openRuntimeSelector,
    openHost,
    openHostActions,
    openResume,
    openTasks,
    openAccounts
  } = useMobileHomeContext()
  const { session } = useMobileAuthSession()
  const { isWideLayout, contentMaxWidth } = useResponsiveLayout()
  const pairDesktop = () => data.router.push('/pair-scan')
  const hasLocalPairing = data.hostCatalog.some(hostCatalogEntryHasLocalPairing)
  if (!session && !hasLocalPairing) {
    return (
      <MobileHomeEmptyState
        bottomInset={0}
        contentMaxWidth={contentMaxWidth}
        isWideLayout={isWideLayout}
        onPairDesktop={pairDesktop}
        method={connectionMethod}
        onMethodChange={setConnectionMethod}
        accountComputers={data.hostCatalog.filter((host) =>
          host.accessSources?.includes('account-claimed')
        )}
        connectionStates={data.hostStates}
        selectedId={selectedRuntime?.id ?? null}
        onSelectComputer={() => openRuntimeSelector(true)}
        onOpenComputer={openHost}
      />
    )
  }
  return (
    <MobileHomeHostList
      autoConnectHostIds={data.autoConnectHostIds}
      bottomInset={0}
      contentMaxWidth={contentMaxWidth}
      footer={
        <View>
          <MobileHomeListFooter
            accountsHosts={data.accountsHosts}
            connectedHosts={data.connectedHosts}
            primaryHost={activeConnectedHost}
            primaryTaskProviders={
              activeConnectedHost ? (data.taskProvidersByHost[activeConnectedHost.id] ?? []) : []
            }
            resumeCard={data.resumeCard}
            onCreateWorkspace={(hostId) => data.router.push(hostNewWorktreeRoute(hostId))}
            onOpenAccounts={openAccounts}
            onOpenResume={openResume}
            onOpenTasks={openTasks}
            onPairDesktop={pairDesktop}
          />
        </View>
      }
      hostAttempts={data.hostAttempts}
      hostLastConnected={data.hostLastConnected}
      hostConnections={data.hostConnections}
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
