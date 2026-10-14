import { AgentPreferencesHint } from './AgentPreferencesHint'
import { useMountedRef } from '@/hooks/useMountedRef'
import { useMemo } from 'react'
import { Laptop, Server } from 'lucide-react'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import type { TuiAgent } from '../../../../shared/tui-agent'
import {
  AGENT_INSTALL_PROVIDERS,
  AGENT_UPGRADE_COMMANDS
} from '../../../../shared/agent-install-providers'
import { normalizeAgentNpmRegistry } from '../../../../shared/agent-npm-registry'
import { getAgentCatalog } from '@/lib/agent-catalog'
import { useDetectedAgents, type AgentDetectionTarget } from '@/hooks/useDetectedAgents'
import { useAppStore } from '@/store'
import {
  getLocalAgentPreflightContext,
  localPreflightContextKey
} from '@/lib/local-preflight-context'
import { getRendererAppPlatform } from '@/lib/renderer-app-platform'
import { isPairedWebClientWindow } from '@/lib/desktop-window-chrome'
import { CodexTerminalServerIsolationSetting } from './CodexTerminalServerIsolationSetting'
import {
  getTuiAgentDefaultArgs,
  getTuiAgentDefaultEnv,
  resolveTuiAgentLaunchArgs,
  resolveTuiAgentLaunchEnv
} from '../../../../shared/tui-agent-launch-defaults'
import {
  isTuiAgentEnabled,
  normalizeDisabledTuiAgents
} from '../../../../shared/tui-agent-selection'
import { AgentRuntimeSetting } from './AgentRuntimeSetting'
import { buildCodexSessionSourceHomeControl } from './codex-session-source-home-control'
import { getSettingOwnershipSummary } from './setting-ownership'
import { translate } from '@/i18n/i18n'
import { getAgentsPaneSearchEntries } from './agents-search'
import {
  buildAgentAvailabilitySettingsUpdate,
  createAgentAvailabilityUpdateQueue
} from './agent-availability-settings'
import { AgentAvailabilityControl, type AgentCatalogRowProps } from './AgentCatalogRow'
import { AgentDefaultSetting } from './AgentDefaultSetting'
import { AgentDetectionCatalog } from './AgentDetectionCatalog'
import { AgentRunPreferences, AgentPermissionsSetting } from './AgentRunPreferences'
import { AgentWorkspaceTrustSetting } from './AgentWorkspaceTrustSetting'
export { AgentWorkspaceTrustSetting } from './AgentWorkspaceTrustSetting'
import { AgentAdvancedConfiguration } from './AgentAdvancedConfiguration'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs'
import type { AgentsSettingsTab } from './agents-settings-navigation'
import { useAgentsSettingsNavigation } from './use-agents-settings-navigation'
import { useAgentVersions } from './use-agent-versions'
import { useAgentInstallation } from './use-agent-installation'
import { AgentNpmRegistrySetting } from './AgentNpmRegistrySetting'
import './agents-settings.css'
import { AgentLaunchSettingsSection } from './AgentLaunchSettingsSection'
import type { SettingsHostScope } from './settings-host-scope'
import type {
  AgentLaunchSettings,
  AgentLaunchSettingsMutation
} from '../../../../shared/agent-launch-settings'
import { HostAgentEnvironmentEditor } from './HostAgentEnvironmentEditor'

export {
  buildAgentAvailabilitySettingsUpdate,
  createAgentAvailabilityUpdateQueue,
  getAgentsPaneSearchEntries,
  AgentAvailabilityControl
}
export {
  AgentPermissionsSetting,
  AgentGeneratedTabTitlesSetting,
  AgentStatusHooksSetting
} from './AgentRunPreferences'

type AgentSettingProps = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void | Promise<void>
}

type AgentsPaneProps = AgentSettingProps & {
  /** Host whose agent launch settings and detected agents the pane shows. */
  hostScope: SettingsHostScope
  wslSupportedPlatform?: boolean
  wslAvailable?: boolean
  wslDistros?: string[]
  wslCapabilitiesLoading?: boolean
}
const EMPTY_OVERRIDES = {}
const EMPTY_AGENTS: TuiAgent[] = []

export function AgentsPane(props: AgentsPaneProps): React.JSX.Element {
  return (
    <AgentLaunchSettingsSection
      {...props}
      renderPermissions={(mode, onChange) => (
        <AgentPermissionsSetting mode={mode} onChange={onChange} />
      )}
      renderSettings={(launchSettings, mutate) => (
        <AgentsPaneContent {...props} launchSettings={launchSettings} mutate={mutate} />
      )}
    />
  )
}

function AgentsPaneContent(
  props: AgentsPaneProps & {
    launchSettings: AgentLaunchSettings
    mutate: (mutation: AgentLaunchSettingsMutation) => Promise<void>
  }
): React.JSX.Element {
  const {
    settings,
    updateSettings,
    hostScope,
    launchSettings,
    mutate,
    wslSupportedPlatform,
    wslAvailable,
    wslDistros,
    wslCapabilitiesLoading
  } = props
  const mountedRef = useMountedRef()
  const activeServerEnvironmentId =
    hostScope.target.kind === 'environment' ? hostScope.target.environmentId : null
  const localContext = useAppStore((state) => getLocalAgentPreflightContext(state))
  const contextKey = localPreflightContextKey(localContext)
  const agentDetectionTarget = useMemo<AgentDetectionTarget>(
    () =>
      activeServerEnvironmentId
        ? { kind: 'runtime', environmentId: activeServerEnvironmentId }
        : { kind: 'local', contextKey },
    [activeServerEnvironmentId, contextKey]
  )
  const {
    detectedIds: detectedList,
    detectionFailed,
    isRefreshing,
    refresh: refreshTargetAgents
  } = useDetectedAgents(agentDetectionTarget)
  const refreshLocalAgents = useAppStore((state) => state.refreshDetectedAgents)
  const activeServerName = useAppStore(
    (state) =>
      state.runtimeEnvironments.find((environment) => environment.id === activeServerEnvironmentId)
        ?.name ?? null
  )
  const detectedIds = useMemo(
    () => (detectedList ? new Set<string>(detectedList) : null),
    [detectedList]
  )
  const catalog = getAgentCatalog()
  const defaultAgent = launchSettings.defaultTuiAgent
  const cmdOverrides = launchSettings.agentCmdOverrides
  const agentDefaultArgs = launchSettings.agentDefaultArgs
  const agentDefaultEnv = activeServerEnvironmentId
    ? EMPTY_OVERRIDES
    : (settings.agentDefaultEnv ?? EMPTY_OVERRIDES)
  const disabledAgents = normalizeDisabledTuiAgents(launchSettings.disabledTuiAgents)
  const detectedAgents =
    detectedIds === null ? [] : catalog.filter((agent) => detectedIds.has(agent.id))
  const enabledDetectedAgents = detectedAgents.filter((agent) =>
    isTuiAgentEnabled(agent.id, disabledAgents)
  )
  const undetectedAgents = catalog.filter(
    (agent) => detectedIds !== null && !detectedIds.has(agent.id)
  )
  const platform = getRendererAppPlatform()
  const registry = normalizeAgentNpmRegistry(settings.agentNpmRegistry)
  const wslDistro = activeServerEnvironmentId ? null : (localContext?.wslDistro ?? null)
  const unresolvedLocalTarget =
    !activeServerEnvironmentId &&
    (localContext?.wslDefault === true ||
      (localContext?.projectRuntime && localContext.projectRuntime.status !== 'resolved'))
  const versionTarget = useMemo(
    () => ({ environmentId: activeServerEnvironmentId, platform, wslDistro, registry }),
    [activeServerEnvironmentId, platform, wslDistro, registry]
  )
  const versions = useAgentVersions(
    versionTarget,
    detectedList ?? EMPTY_AGENTS,
    cmdOverrides,
    !detectionFailed && !unresolvedLocalTarget
  )
  const installationAvailable = !detectionFailed && !unresolvedLocalTarget && detectedList !== null
  const installations = useAgentInstallation(
    versionTarget,
    installationAvailable,
    async (agent) => {
      if (!activeServerEnvironmentId) {
        const state = useAppStore.getState()
        const context = getLocalAgentPreflightContext(state)
        if (
          (context?.wslDistro ?? null) !== wslDistro ||
          (!mountedRef.current && Boolean(state.settings?.activeRuntimeEnvironmentId?.trim())) ||
          context?.wslDefault ||
          (context?.projectRuntime && context.projectRuntime.status !== 'resolved')
        ) {
          throw new Error('installation-refresh-target-changed')
        }
      }
      await refreshTargetAgents()
      await versions.refresh(agent)
    }
  )
  const environmentLabel = activeServerEnvironmentId
    ? (activeServerName ?? translate('agentsSettings.remoteRuntime', 'Remote runtime'))
    : wslDistro
      ? `WSL · ${wslDistro}`
      : translate('agentsSettings.localEnvironment', 'Local {{platform}}', {
          platform: platform === 'win32' ? 'Windows' : platform === 'darwin' ? 'macOS' : 'Linux'
        })
  const { navigation, setNavigation, focusRoot, openConfiguration } = useAgentsSettingsNavigation(
    catalog,
    defaultAgent,
    wslSupportedPlatform
  )
  const save = (mutation: AgentLaunchSettingsMutation): void => {
    void mutate(mutation).catch(() => {})
  }
  const getRowProps = (
    agent: (typeof catalog)[number],
    isDetected: boolean
  ): AgentCatalogRowProps => ({
    agentId: agent.id,
    label: agent.label,
    homepageUrl: agent.homepageUrl,
    defaultCmd: agent.cmd,
    defaultArgs: getTuiAgentDefaultArgs(agent.id),
    defaultEnv: getTuiAgentDefaultEnv(agent.id),
    isDetected,
    isEnabled: isTuiAgentEnabled(agent.id, disabledAgents),
    isDefault: isDetected && defaultAgent === agent.id,
    cmdOverride: cmdOverrides[agent.id],
    argsOverride: resolveTuiAgentLaunchArgs(agent.id, agentDefaultArgs),
    envOverride: resolveTuiAgentLaunchEnv(agent.id, agentDefaultEnv),
    versionSnapshot: versions.snapshots[agent.id],
    onRetryVersions: () => versions.retry(agent.id),
    installation: installations.getSnapshot(agent.id),
    installationTarget: versionTarget,
    onInstall:
      !isDetected && AGENT_INSTALL_PROVIDERS[agent.id]
        ? () => void installations.install(agent.id)
        : undefined,
    onUpgrade:
      isDetected &&
      (['npm', 'bun', 'uv', 'binary'].includes(AGENT_INSTALL_PROVIDERS[agent.id]?.kind ?? '') ||
        AGENT_UPGRADE_COMMANDS[agent.id])
        ? (installation) =>
            void installations.install(
              agent.id,
              'upgrade',
              installation.command,
              installation.realPath
            )
        : undefined,
    installDisabled: !installationAvailable,
    onConfigure: () => openConfiguration(agent.id),
    onSetDefault: isDetected ? () => save({ type: 'default', agent: agent.id }) : () => {},
    onSetEnabled: (enabled) => save({ type: 'availability', agent: agent.id, enabled }),
    onSaveOverride: (value) => mutate({ type: 'command', agent: agent.id, value }),
    onSaveArgs: (value) => mutate({ type: 'arguments', agent: agent.id, value }),
    onSaveEnv: (value) => {
      if (!activeServerEnvironmentId) {
        void updateSettings({ agentDefaultEnv: { ...agentDefaultEnv, [agent.id]: value } })
      }
    },
    ...(activeServerEnvironmentId
      ? {
          environmentNames: launchSettings.environmentNames[agent.id] ?? [],
          environmentEditor: (
            <HostAgentEnvironmentEditor
              agent={agent.id}
              names={launchSettings.environmentNames[agent.id] ?? []}
              mutate={mutate}
            />
          )
        }
      : {}),
    sessionSourceHome:
      isDetected && !activeServerEnvironmentId && agent.id === 'codex'
        ? buildCodexSessionSourceHomeControl(settings, updateSettings)
        : undefined
  })

  return (
    <div className="agents-settings" ref={focusRoot}>
      <Tabs
        value={navigation.tab}
        onValueChange={(value) =>
          setNavigation({ ...navigation, tab: value as AgentsSettingsTab, focusTarget: '' })
        }
        className="gap-0"
      >
        <TabsList
          variant="line"
          className="agents-settings-tabs"
          aria-label={translate('agentsSettings.tabsLabel', 'Agent settings')}
        >
          <TabsTrigger value="manage">
            {translate('agentsSettings.manage', 'Agent management')}
          </TabsTrigger>
          <TabsTrigger value="preferences">
            {translate('agentsSettings.preferences', 'Run preferences')}
          </TabsTrigger>
          <TabsTrigger value="advanced">
            {translate('agentsSettings.advanced', 'Advanced configuration')}
          </TabsTrigger>
        </TabsList>
        <div className="agents-settings-context" id="agent-runtime">
          <div className="flex min-w-0 flex-wrap items-center gap-5">
            <span className="inline-flex min-w-0 items-center gap-3 text-sm font-medium">
              {activeServerEnvironmentId ? (
                <Server className="size-5 shrink-0" />
              ) : (
                <Laptop className="size-5 shrink-0" />
              )}
              <span className="break-words">{environmentLabel}</span>
              <span className="border-l border-border pl-4 text-[13px] font-normal text-muted-foreground">
                {translate('agentsSettings.currentEnvironment', 'Current environment')}
              </span>
            </span>
            {!activeServerEnvironmentId ? (
              <AgentRuntimeSetting
                settings={settings}
                updateSettings={updateSettings}
                refresh={refreshLocalAgents}
                wslSupportedPlatform={wslSupportedPlatform}
                wslAvailable={wslAvailable}
                wslDistros={wslDistros}
                wslCapabilitiesLoading={wslCapabilitiesLoading}
                compact
              />
            ) : null}
          </div>
          <AgentDefaultSetting
            defaultAgent={defaultAgent}
            detectedIds={detectedIds}
            enabledDetectedAgents={enabledDetectedAgents}
            catalog={catalog}
            description={getSettingOwnershipSummary('agentLaunchDefaults').description}
            onSetDefault={(agent) => save({ type: 'default', agent })}
          />
        </div>
        <TabsContent
          value="manage"
          forceMount
          hidden={navigation.tab !== 'manage'}
          className="space-y-8"
        >
          <AgentNpmRegistrySetting
            value={registry}
            onChange={(agentNpmRegistry) => updateSettings({ agentNpmRegistry })}
          />
          <AgentDetectionCatalog
            detectedAgents={detectedAgents}
            undetectedAgents={undetectedAgents}
            detectionPending={detectedIds === null}
            detectionFailed={Boolean(detectionFailed || unresolvedLocalTarget)}
            environmentUnavailable={Boolean(unresolvedLocalTarget)}
            isRefreshing={isRefreshing}
            onRefresh={() => void refreshTargetAgents()}
            onCheckUpdates={() => void versions.checkLatest()}
            isCheckingUpdates={Object.values(versions.snapshots).some(
              (snapshot) => snapshot.latestLoading
            )}
            getRowProps={getRowProps}
          />
          <AgentPreferencesHint
            onOpen={() => setNavigation({ ...navigation, tab: 'preferences', focusTarget: '' })}
          />
        </TabsContent>
        <TabsContent value="preferences" forceMount hidden={navigation.tab !== 'preferences'}>
          <AgentRunPreferences
            settings={settings}
            updateSettings={updateSettings}
            permissions={
              <AgentPermissionsSetting
                mode={launchSettings.permissionMode}
                onChange={(mode) => save({ type: 'permissions', mode })}
              />
            }
          />
          {!isPairedWebClientWindow() ? (
            <div className="mt-6 space-y-6">
              <AgentWorkspaceTrustSetting settings={settings} updateSettings={updateSettings} />
              <CodexTerminalServerIsolationSetting
                settings={settings}
                updateSettings={updateSettings}
              />
            </div>
          ) : null}
        </TabsContent>
        <TabsContent value="advanced" forceMount hidden={navigation.tab !== 'advanced'}>
          <AgentAdvancedConfiguration
            catalog={catalog}
            detectedIds={detectedIds}
            selectedAgent={navigation.agent}
            onSelectAgent={openConfiguration}
            environmentLabel={environmentLabel}
            getRowProps={getRowProps}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}
