import { useEffect, useRef, useState } from 'react'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import type { PublicKnownRuntimeEnvironment } from '../../../../shared/runtime-environments'
import { useAppStore } from '@/store'
import { SearchableSetting } from './SearchableSetting'
import {
  getRuntimeEnvironmentsSearchEntry,
  getWebRuntimeEnvironmentsSearchEntry
} from './runtime-environments-search'
import {
  getRuntimeEnvironmentRemovalPresentation,
  isRuntimeEnvironmentRemovalBlocked
} from './runtime-environment-host-details'
import { RuntimeServersConnectSection } from './runtime-servers-connect-section'
import { RuntimeActiveServerSection } from './runtime-active-server-section'
import {
  RuntimeEnvironmentRemoveDialog,
  RuntimeEnvironmentSwitchDialog
} from './runtime-environment-dialogs'
import { RuntimeConnectionTroubleshooting } from './runtime-connection-troubleshooting'
import { RuntimeCloudDisplayNameDialog } from './RuntimeCloudDisplayNameDialog'
import { useRuntimeCloudAliasSettings } from './use-runtime-cloud-alias-settings'
import { RuntimeCloudAliasesSection } from './runtime-cloud-aliases-section'
import { useRuntimeEnvironmentCatalog } from './use-runtime-environment-catalog'
import { useRuntimeEnvironmentConnectionActions } from './use-runtime-environment-connection-actions'
import { useRuntimeEnvironmentMutationActions } from './use-runtime-environment-mutation-actions'
import { LOCAL_RUNTIME_VALUE, NO_RUNTIME_VALUE } from './runtime-environment-selection'

export {
  canConnectRuntimeEnvironment,
  evaluateHostDetails,
  getActiveServerModeDescription,
  getHostDetailsDescription,
  getHostDetailsSummary,
  getHostModelCapabilitySummary,
  getRuntimeCapabilitiesSummary,
  getRuntimeEnvironmentEndpointDisplay,
  getRuntimeEnvironmentInitialDetails,
  getRuntimeEnvironmentRemovalPresentation,
  getRuntimeServerConnectionState,
  isRuntimeServerTransportConnected,
  isRuntimeEnvironmentRemovalBlocked,
  resolveRuntimeCloudRenameEnvironment,
  supportsLocalRuntimeEnvironmentRemoval
} from './runtime-environment-host-details'
export type {
  RuntimeEnvironmentRemovalPresentation,
  RuntimeHostDetails
} from './runtime-environment-host-details'

type RuntimeEnvironmentsPaneProps = {
  settings: GlobalSettings
  setActiveRuntimeEnvironmentPreference: (environmentId: string | null) => Promise<boolean>
  allowLocalRuntime?: boolean
  addServerIntentSignal?: number
}

export function RuntimeEnvironmentsPane({
  settings,
  setActiveRuntimeEnvironmentPreference,
  allowLocalRuntime = true,
  addServerIntentSignal
}: RuntimeEnvironmentsPaneProps): React.JSX.Element {
  const [pendingSwitchValue, setPendingSwitchValue] = useState<string | null>(null)
  const [pendingRemove, setPendingRemove] = useState<PublicKnownRuntimeEnvironment | null>(null)
  const [addServerFormOpen, setAddServerFormOpen] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const remoteServerUpdates = useAppStore((state) => state.remoteServerUpdates)
  const remoteServerUpdatesChecking = useAppStore((state) => state.remoteServerUpdatesChecking)
  const remoteServerUpdatesRunning = useAppStore((state) => state.remoteServerUpdatesRunning)
  const refreshRemoteServerUpdates = useAppStore((state) => state.refreshRemoteServerUpdates)
  const setRemoteServerUpdateDialogOpen = useAppStore(
    (state) => state.setRemoteServerUpdateDialogOpen
  )
  const refreshAccountRuntimeCloud = useAppStore((state) => state.refreshAccountRuntimeCloud)
  const consumedAddServerIntentSignalRef = useRef(0)
  const {
    environments,
    isLoading,
    detailsByEnvironmentId,
    setDetailsByEnvironmentId,
    mountedRef,
    loadEnvironments
  } = useRuntimeEnvironmentCatalog()
  const cloudAlias = useRuntimeCloudAliasSettings(settings, environments)

  const getEnvironmentLabel = (value: string): string => {
    if (value === LOCAL_RUNTIME_VALUE) {
      return cloudAlias.localEnvironment?.name ?? 'Local desktop'
    }
    if (value === NO_RUNTIME_VALUE) {
      return 'No Runtime connected'
    }
    return environments.find((environment) => environment.id === value)?.name ?? 'remote Runtime'
  }
  const {
    connectingId,
    switchingValue,
    disconnectingId,
    switchError,
    setSwitchError,
    connectEnvironment,
    disconnectEnvironment,
    switchToValue
  } = useRuntimeEnvironmentConnectionActions({
    allowLocalRuntime,
    mountedRef,
    setDetailsByEnvironmentId,
    setActiveRuntimeEnvironmentPreference,
    getEnvironmentLabel
  })
  const {
    isSaving,
    removingId,
    removeError,
    setRemoveError,
    name,
    setName,
    pairingCode,
    setPairingCode,
    addServerFailure,
    setAddServerFailure,
    closeAddServerForm,
    addEnvironment,
    removeEnvironment
  } = useRuntimeEnvironmentMutationActions({
    environments,
    settings,
    allowLocalRuntime,
    mountedRef,
    setAddServerFormOpen,
    loadEnvironments,
    connectEnvironment
  })

  const environmentIdsKey = environments.map((environment) => environment.id).join('\n')
  useEffect(() => {
    void refreshRemoteServerUpdates()
  }, [environmentIdsKey, refreshRemoteServerUpdates])
  useEffect(() => {
    if (
      !addServerIntentSignal ||
      consumedAddServerIntentSignalRef.current === addServerIntentSignal
    ) {
      return
    }
    consumedAddServerIntentSignalRef.current = addServerIntentSignal
    setAddServerFormOpen(true)
  }, [addServerIntentSignal])

  const activeValue =
    settings.activeRuntimeEnvironmentId ??
    (allowLocalRuntime ? LOCAL_RUNTIME_VALUE : NO_RUNTIME_VALUE)
  const isBusy =
    isSaving ||
    connectingId !== null ||
    switchingValue !== null ||
    removingId !== null ||
    disconnectingId !== null
  const removingActiveServer = pendingRemove
    ? isRuntimeEnvironmentRemovalBlocked(settings.activeRuntimeEnvironmentId, pendingRemove.id)
    : false
  const searchEntry = allowLocalRuntime
    ? getRuntimeEnvironmentsSearchEntry()
    : getWebRuntimeEnvironmentsSearchEntry()

  const openRemoveDialog = (environment: PublicKnownRuntimeEnvironment): void => {
    if (
      !getRuntimeEnvironmentRemovalPresentation(
        environment,
        isRuntimeEnvironmentRemovalBlocked(settings.activeRuntimeEnvironmentId, environment.id)
      )
    ) {
      return
    }
    setRemoveError(null)
    setPendingRemove(environment)
  }
  const confirmSwitch = (): void => {
    const value = pendingSwitchValue
    if (!value) {
      return
    }
    void switchToValue(value).then((switched) => {
      if (switched && mountedRef.current) {
        setPendingSwitchValue(null)
      }
    })
  }
  const confirmRemove = (): void => {
    const environment = pendingRemove
    if (!environment) {
      return
    }
    void removeEnvironment(environment).then((removed) => {
      if (removed && mountedRef.current) {
        setPendingRemove(null)
      }
    })
  }
  return (
    <SearchableSetting
      forceVisible
      title={searchEntry.title}
      description={searchEntry.description}
      keywords={searchEntry.keywords}
      className="space-y-4 py-2"
    >
      {allowLocalRuntime ? (
        <RuntimeCloudAliasesSection
          settings={settings}
          localEnvironment={cloudAlias.localEnvironment}
          environments={environments}
          onRename={cloudAlias.open}
        />
      ) : null}
      <RuntimeServersConnectSection
        visible
        environments={environments}
        detailsByEnvironmentId={detailsByEnvironmentId}
        activeRuntimeEnvironmentId={settings.activeRuntimeEnvironmentId}
        addServerFormOpen={addServerFormOpen}
        name={name}
        pairingCode={pairingCode}
        addServerFailure={addServerFailure}
        isBusy={isBusy}
        remoteServerUpdates={remoteServerUpdates}
        remoteServerUpdatesChecking={remoteServerUpdatesChecking}
        remoteServerUpdatesRunning={remoteServerUpdatesRunning}
        connectingId={connectingId}
        switchingValue={switchingValue}
        disconnectingId={disconnectingId}
        removingId={removingId}
        onOpenAddServerForm={() => setAddServerFormOpen(true)}
        onCloseAddServerForm={closeAddServerForm}
        onNameChange={setName}
        onPairingCodeChange={(value) => {
          setPairingCode(value)
          setAddServerFailure(null)
        }}
        onAddEnvironment={(allowLoopback) => void addEnvironment(allowLoopback)}
        onOpenUpdateDialog={() => setRemoteServerUpdateDialogOpen(true)}
        refreshRemoteServerUpdates={refreshRemoteServerUpdates}
        onConnect={(environment) => void connectEnvironment(environment)}
        onDisconnect={(environment) => void disconnectEnvironment(environment)}
        onRemove={openRemoveDialog}
        canRenameCloud={cloudAlias.canRename}
        onRenameCloud={cloudAlias.open}
      />

      <RuntimeActiveServerSection
        visible
        advancedOpen={advancedOpen}
        allowLocalRuntime={allowLocalRuntime}
        localRuntimeValue={LOCAL_RUNTIME_VALUE}
        localDisplayName={cloudAlias.localEnvironment?.name}
        noRuntimeValue={NO_RUNTIME_VALUE}
        activeValue={activeValue}
        environments={environments}
        detailsByEnvironmentId={detailsByEnvironmentId}
        isBusy={isBusy}
        isLoading={isLoading}
        onToggleAdvanced={() => setAdvancedOpen((current) => !current)}
        onValueChange={(value) => {
          setSwitchError(null)
          setPendingSwitchValue(value)
        }}
        onRefresh={() => void refreshAccountRuntimeCloud().then(() => loadEnvironments())}
      />

      <RuntimeConnectionTroubleshooting />

      <RuntimeEnvironmentSwitchDialog
        pendingSwitchValue={pendingSwitchValue}
        switchingValue={switchingValue}
        switchError={switchError}
        getEnvironmentLabel={getEnvironmentLabel}
        onOpenChange={(open) => {
          if (!open && switchingValue === null) {
            setSwitchError(null)
            setPendingSwitchValue(null)
          }
        }}
        onCancel={() => {
          setSwitchError(null)
          setPendingSwitchValue(null)
        }}
        onConfirm={confirmSwitch}
      />

      <RuntimeEnvironmentRemoveDialog
        pendingRemove={pendingRemove}
        removingId={removingId}
        removeError={removeError}
        removingActiveServer={removingActiveServer}
        onOpenChange={(open) => {
          if (!open && removingId === null) {
            setRemoveError(null)
            setPendingRemove(null)
          }
        }}
        onCancel={() => {
          setRemoveError(null)
          setPendingRemove(null)
        }}
        onConfirm={confirmRemove}
      />

      <RuntimeCloudDisplayNameDialog
        environment={cloudAlias.environment}
        onClose={cloudAlias.close}
      />
    </SearchableSetting>
  )
}
