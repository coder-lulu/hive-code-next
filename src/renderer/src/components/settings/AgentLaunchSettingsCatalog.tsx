import { AgentAdvancedConfiguration } from './AgentAdvancedConfiguration'
import { useMemo, useState } from 'react'
import type {
  AgentLaunchSettings,
  AgentLaunchSettingsMutation
} from '../../../../shared/agent-launch-settings'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import type { AgentPermissionChoice } from '../../../../shared/tui-agent-permission-choice'
import {
  getTuiAgentDefaultArgs,
  getTuiAgentDefaultEnv
} from '../../../../shared/tui-agent-launch-defaults'
import { isTuiAgentEnabled } from '../../../../shared/tui-agent-selection'
import { getAgentCatalog } from '@/lib/agent-catalog'
import { useDetectedAgents, type AgentDetectionTarget } from '@/hooks/useDetectedAgents'
import { AgentDefaultSetting } from './AgentDefaultSetting'
import { AgentDetectionCatalog } from './AgentDetectionCatalog'
import type { AgentCatalogRowProps } from './AgentCatalogRow'
import { HostAgentEnvironmentEditor } from './HostAgentEnvironmentEditor'
import { buildCodexSessionSourceHomeControl } from './codex-session-source-home-control'
import { Loader2 } from 'lucide-react'
import type { TuiAgent } from '../../../../shared/tui-agent'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '../../store'
import { LOCAL_EXECUTION_HOST_ID } from '../../../../shared/execution-host'
import { chatProviderAgents, useHostStructuredAgentsVersion } from '@/lib/chat-provider-agents'
import {
  readChatProgram,
  resolveChatProgramContext,
  agentChoiceOpensAsChat
} from '@/lib/host-chat-program'
import { useChatProgramFacts } from '@/lib/host-chat-program-acquisition'
import { readHostStructuredAgents } from '@/runtime/host-structured-agents'
import { buildAgentOpensAs } from './native-chat-provider-choice'
import { AgentChatRuntimeArea } from './AgentChatChoiceControls'
import type { ProspectiveWorkspace } from '@/lib/agent-launch-route-input'
import { readNativeDetectedAgents } from '@/store/slices/local-detected-agent-store-state'

export type AgentPermissionsRenderer = (
  mode: AgentPermissionChoice,
  onChange: (mode: AgentPermissionChoice) => void
) => React.ReactNode

export type AgentEnvironmentWriter = (
  agent: TuiAgent,
  value: Record<string, string>
) => Promise<void>

export function AgentLaunchSettingsCatalog({
  settings,
  mutate,
  detectionTarget,
  renderPermissions,
  refreshSettings,
  local,
  hostName
}: {
  settings: AgentLaunchSettings
  mutate: (mutation: AgentLaunchSettingsMutation) => Promise<void>
  detectionTarget: AgentDetectionTarget
  hostName: string | null
  renderPermissions: AgentPermissionsRenderer
  autoSupported?: boolean
  nativeChatPermissionsSupported?: boolean
  chatOwnSupported?: boolean
  refreshSettings?: () => void
  local?: {
    saveEnvironment: (agent: TuiAgent, value: Record<string, string>) => Promise<void>
    settings: GlobalSettings
    updateSettings: (updates: Partial<GlobalSettings>) => void | Promise<void>
  }
}): React.JSX.Element {
  const {
    detectedIds: detected,
    detectionFailed,
    isRefreshing,
    refresh
  } = useDetectedAgents(detectionTarget, 'all')
  const detectedIds = useMemo(() => (detected ? new Set(detected) : null), [detected])
  const catalog = getAgentCatalog()
  useHostStructuredAgentsVersion()
  const chatWorkspace = {
    kind: 'folder',
    executionHostId: LOCAL_EXECUTION_HOST_ID
  } satisfies ProspectiveWorkspace
  useChatProgramFacts(chatWorkspace, Boolean(local))
  const nativeDetected = useAppStore(readNativeDetectedAgents)
  const store = useAppStore.getState()
  const chatHost = resolveChatProgramContext(store, chatWorkspace)
  const chosen = settings.defaultTuiAgent
  const defaultOpensAsChat = useAppStore((state) =>
    local && chosen && chosen !== 'blank'
      ? agentChoiceOpensAsChat(state, chosen, chatWorkspace, nativeDetected)
      : false
  )
  const chatProviders = local ? chatProviderAgents(LOCAL_EXECUTION_HOST_ID, undefined) : []
  const managedChatAgents = local
    ? (readHostStructuredAgents(LOCAL_EXECUTION_HOST_ID, undefined) ?? [])
    : []
  const chatProgramHere = (agent: TuiAgent) =>
    Boolean(local) && readChatProgram(store, agent, chatHost, nativeDetected) === 'available'
  const [selectedAgent, setSelectedAgent] = useState(catalog[0].id)
  const detectedAgents = catalog.filter(
    (agent) => detectedIds?.has(agent.id) || chatProgramHere(agent.id)
  )
  const undetectedAgents = catalog.filter(
    (agent) =>
      !detectedAgents.includes(agent) && (detectedIds !== null || chatProviders.includes(agent.id))
  )
  const save = (mutation: AgentLaunchSettingsMutation): void => {
    void mutate(mutation).catch(() => {})
  }
  const rowProps = (
    agent: (typeof catalog)[number],
    listedInstalled: boolean
  ): AgentCatalogRowProps => {
    const isDetected = listedInstalled && detectedIds?.has(agent.id) === true
    return {
      onConfigure: () => setSelectedAgent(agent.id),
      agentId: agent.id,
      label: agent.label,
      homepageUrl: agent.homepageUrl,
      defaultCmd: agent.cmd,
      defaultArgs: getTuiAgentDefaultArgs(agent.id),
      defaultEnv: getTuiAgentDefaultEnv(agent.id),
      isDetected,
      opensAs: local
        ? buildAgentOpensAs({
            agent: agent.id,
            cliDetected: nativeDetected === null ? null : nativeDetected.includes(agent.id),
            chatProgramHere: chatProgramHere(agent.id),
            settings: local.settings,
            updateSettings: local.updateSettings
          })
        : undefined,
      chatRuntime: managedChatAgents.some((row) => row.agent === agent.id && row.managedRuntime) ? (
        <AgentChatRuntimeArea agent={agent.id} label={agent.label} />
      ) : undefined,
      isEnabled: isTuiAgentEnabled(agent.id, settings.disabledTuiAgents),
      isDefault: isDetected && settings.defaultTuiAgent === agent.id,
      cmdOverride: isDetected ? settings.agentCmdOverrides[agent.id] : undefined,
      argsOverride: settings.agentDefaultArgs[agent.id] ?? getTuiAgentDefaultArgs(agent.id),
      envOverride: local
        ? (local.settings.agentDefaultEnv?.[agent.id] ?? getTuiAgentDefaultEnv(agent.id))
        : {},
      onSetDefault: () =>
        save({
          type: 'default',
          agent: settings.defaultTuiAgent === agent.id ? 'blank' : agent.id
        }),
      onSetEnabled: (enabled) => save({ type: 'availability', agent: agent.id, enabled }),
      onSaveOverride: (value) => mutate({ type: 'command', agent: agent.id, value }),
      onSaveArgs: (value) => mutate({ type: 'arguments', agent: agent.id, value }),
      onSaveEnv: (value) => local?.saveEnvironment(agent.id, value),
      ...(!local
        ? {
            environmentNames: settings.environmentNames[agent.id] ?? [],
            environmentEditor: (
              <HostAgentEnvironmentEditor
                agent={agent.id}
                names={settings.environmentNames[agent.id] ?? []}
                mutate={mutate}
              />
            )
          }
        : {}),
      sessionSourceHome:
        local && isDetected && agent.id === 'codex'
          ? buildCodexSessionSourceHomeControl(local.settings, local.updateSettings)
          : undefined
    }
  }
  return (
    <>
      <AgentDefaultSetting
        defaultAgent={settings.defaultTuiAgent}
        defaultOpensAsChat={defaultOpensAsChat}
        detectedIds={detectedIds}
        enabledDetectedAgents={detectedAgents.filter(
          (agent) =>
            detectedIds?.has(agent.id) && isTuiAgentEnabled(agent.id, settings.disabledTuiAgents)
        )}
        catalog={catalog}
        description={translate(
          'settings.agents.hostDefaults',
          'Defaults for new agents on the selected host.'
        )}
        onSetDefault={(agent) => save({ type: 'default', agent })}
      />
      {renderPermissions(settings.agentPermissionDefault, (mode) =>
        save({ type: 'permissions', mode })
      )}
      <AgentDetectionCatalog
        detectedAgents={detectedAgents}
        undetectedAgents={undetectedAgents}
        detectionPending={detectedIds === null}
        detectionFailed={detectionFailed}
        isRefreshing={isRefreshing}
        activeServerEnvironmentId={
          detectionTarget.kind === 'runtime' ? detectionTarget.environmentId : null
        }
        activeServerName={hostName}
        onRefresh={() => {
          void refresh()
          refreshSettings?.()
        }}
        getRowProps={rowProps}
      />
      <AgentAdvancedConfiguration
        catalog={catalog}
        detectedIds={detectedIds}
        selectedAgent={selectedAgent}
        onSelectAgent={setSelectedAgent}
        environmentLabel={detectionTarget.kind === 'runtime' ? detectionTarget.environmentId : ''}
        getRowProps={rowProps}
      />
    </>
  )
}

export type AgentLaunchSettingsRenderer = (
  settings: AgentLaunchSettings,
  mutate: (mutation: AgentLaunchSettingsMutation) => Promise<void>,
  saveEnvironment?: AgentEnvironmentWriter
) => React.ReactNode

export function AgentLaunchSettingsLoading(): React.JSX.Element {
  return (
    <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" />
      {translate('settings.agents.loading', 'Loading agent settings…')}
    </div>
  )
}
