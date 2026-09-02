import { useEffect, useRef, useState } from 'react'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import type { PublicKnownRuntimeEnvironment } from '../../../../shared/runtime-environments'
import { useAppStore } from '@/store'
import { cn } from '@/lib/utils'
import { SearchableSetting } from './SearchableSetting'
import { EphemeralVmRuntimesSection } from './EphemeralVmRuntimesSection'
import { CloudVmSetupGuide } from './CloudVmSetupGuide'
import {
  getRuntimeEnvironmentsSearchEntry,
  getWebRuntimeEnvironmentsSearchEntry
} from './runtime-environments-search'
import {
  getRuntimeEnvironmentRemovalPresentation,
  isRuntimeEnvironmentRemovalBlocked,
  resolveRuntimeCloudRenameEnvironment
} from './runtime-environment-host-details'
import { RuntimeServersConnectSection } from './runtime-servers-connect-section'
import { RuntimeActiveServerSection } from './runtime-active-server-section'
import {
  RuntimeEnvironmentRemoveDialog,
  RuntimeEnvironmentSwitchDialog
} from './runtime-environment-dialogs'
import {
  RuntimeServerShareSection,
  RuntimeServerTroubleshooting,
  RuntimeServerWorkflowPicker,
  type RemoteServerWorkflow
} from './runtime-server-workflow-sections'
import { RuntimeCloudDisplayNameDialog } from './RuntimeCloudDisplayNameDialog'
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
  canGeneratePairingUrl?: boolean
  allowLocalRuntime?: boolean
  addServerIntentSignal?: number
}

export function RuntimeEnvironmentsPane({
  settings,
  setActiveRuntimeEnvironmentPreference,
  canGeneratePairingUrl = true,
  allowLocalRuntime = true,
  addServerIntentSignal
}: RuntimeEnvironmentsPaneProps): React.JSX.Element {
  const [pendingSwitchValue, setPendingSwitchValue] = useState<string | null>(null)
  const [pendingRemove, setPendingRemove] = useState<PublicKnownRuntimeEnvironment | null>(null)
  const [pendingCloudRenameId, setPendingCloudRenameId] = useState<string | null>(null)
  const [pendingCloudRenameScopeKey, setPendingCloudRenameScopeKey] = useState<string | null>(
    null
  )
  const [addServerFormOpen, setAddServerFormOpen] = useState(false)
  const [shareServerFormOpen, setShareServerFormOpen] = useState(true)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [workflow, setWorkflow] = useState<RemoteServerWorkflow>('connect')
  const remoteServerUpdates = useAppStore((state) => state.remoteServerUpdates)
  const remoteServerUpdatesChecking = useAppStore((state) => state.remoteServerUpdatesChecking)
  const remoteServerUpdatesRunning = useAppStore((state) => state.remoteServerUpdatesRunning)
  const refreshRemoteServerUpdates = useAppStore((state) => state.refreshRemoteServerUpdates)
  const setRemoteServerUpdateDialogOpen = useAppStore(
    (state) => state.setRemoteServerUpdateDialogOpen
  )
  const accountRuntimeDirectory = useAppStore((state) => state.accountRuntimeDirectory)
  const currentCloudRenameScopeKey =
    accountRuntimeDirectory.accountId && accountRuntimeDirectory.sessionGeneration != null
      ? `${accountRuntimeDirectory.accountId}\u0000${accountRuntimeDirectory.sessionGeneration}`
      : null
  const consumedAddServerIntentSignalRef = useRef(0)
  const {
    environments,
    isLoading,
    detailsByEnvironmentId,
    setDetailsByEnvironmentId,
    mountedRef,
    loadEnvironments
  } = useRuntimeEnvironmentCatalog()
  const pendingCloudRename = resolveRuntimeCloudRenameEnvironment(
    environments,
    pendingCloudRenameId,
    pendingCloudRenameScopeKey,
    currentCloudRenameScopeKey
  )

  const getEnvironmentLabel = (value: string): string => {
    if (value === LOCAL_RUNTIME_VALUE) {
      return 'Local desktop'
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
  useEffect(() => {
    if (pendingCloudRenameId !== null && pendingCloudRename === null) {
      setPendingCloudRenameId(null)
      setPendingCloudRenameScopeKey(null)
    }
  }, [pendingCloudRename, pendingCloudRenameId])

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
  const searchEntry = canGeneratePairingUrl
    ? getRuntimeEnvironmentsSearchEntry()
    : getWebRuntimeEnvironmentsSearchEntry()
  const visibleWorkflow: RemoteServerWorkflow = addServerFormOpen ? 'connect' : workflow

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
  const openCloudRenameDialog = (environment: PublicKnownRuntimeEnvironment): void => {
    if (!currentCloudRenameScopeKey || environment.accountClaim?.cloudDisplayNameVersion == null) {
      return
    }
    setPendingCloudRenameScopeKey(currentCloudRenameScopeKey)
    setPendingCloudRenameId(environment.id)
  }

  return (
    <SearchableSetting
      title={searchEntry.title}
      description={searchEntry.description}
      keywords={searchEntry.keywords}
      className="space-y-4 py-2"
    >
      <RuntimeServerWorkflowPicker
        canGeneratePairingUrl={canGeneratePairingUrl}
        visibleWorkflow={visibleWorkflow}
        onCloseAddServerForm={closeAddServerForm}
        onWorkflowChange={setWorkflow}
      />

      <RuntimeServersConnectSection
        visible={visibleWorkflow === 'connect'}
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
        canRenameCloud={currentCloudRenameScopeKey !== null}
        onRenameCloud={openCloudRenameDialog}
      />

      <div className={cn('space-y-5 pt-2', visibleWorkflow !== 'cloud-vm' && 'hidden')}>
        <CloudVmSetupGuide />
        <EphemeralVmRuntimesSection active={visibleWorkflow === 'cloud-vm'} />
      </div>

      <RuntimeActiveServerSection
        visible={visibleWorkflow === 'connect'}
        advancedOpen={advancedOpen}
        allowLocalRuntime={allowLocalRuntime}
        localRuntimeValue={LOCAL_RUNTIME_VALUE}
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
        onRefresh={() => void loadEnvironments()}
      />

      {visibleWorkflow === 'share' && canGeneratePairingUrl ? (
        <RuntimeServerShareSection
          shareServerFormOpen={shareServerFormOpen}
          onToggleShareServerForm={() => setShareServerFormOpen((open) => !open)}
        />
      ) : null}

      {visibleWorkflow === 'connect' ? <RuntimeServerTroubleshooting /> : null}

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
        environment={pendingCloudRename}
        onClose={() => {
          setPendingCloudRenameId(null)
          setPendingCloudRenameScopeKey(null)
        }}
      />
    </SearchableSetting>
  )
}
