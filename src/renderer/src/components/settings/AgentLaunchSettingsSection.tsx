import { useRef } from 'react'
import { getRendererAppPlatform } from '@/lib/renderer-app-platform'
import { useAppStore } from '@/store'
import {
  agentLaunchSettingsMutationUpdates,
  projectAgentLaunchSettings,
  type AgentLaunchSettings,
  type AgentLaunchSettingsMutation
} from '../../../../shared/agent-launch-settings'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import {
  AgentLaunchSettingsCatalog,
  type AgentPermissionsRenderer
} from './AgentLaunchSettingsCatalog'
import { HostAgentLaunchSettings } from './HostAgentLaunchSettings'
import { SettingsHostScopeUnavailableNotice } from './SettingsHostScopePicker'
import type { SettingsHostScope } from './settings-host-scope'
import { runtimeTargetEnvironmentId } from '@/runtime/runtime-client-target'
import { translate } from '@/i18n/i18n'

export type AgentLaunchSettingsRenderer = (
  settings: AgentLaunchSettings,
  mutate: (mutation: AgentLaunchSettingsMutation) => Promise<void>
) => React.ReactNode

export function AgentLaunchSettingsSection({
  settings,
  updateSettings,
  hostScope,
  renderPermissions,
  renderSettings
}: {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void | Promise<void>
  /** Host chosen in the Settings host menu; launch settings are edited in that host's store. */
  hostScope: SettingsHostScope
  renderSettings?: AgentLaunchSettingsRenderer
  renderPermissions: AgentPermissionsRenderer
}): React.JSX.Element {
  const environmentId = runtimeTargetEnvironmentId(hostScope.target)
  const environment = useAppStore((state) =>
    environmentId ? state.runtimeEnvironments.find((entry) => entry.id === environmentId) : null
  )
  return (
    <section className="space-y-8">
      {!hostScope.available ? (
        <SettingsHostScopeUnavailableNotice />
      ) : !environmentId ? (
        <LocalAgentLaunchSettings
          settings={settings}
          updateSettings={updateSettings}
          renderPermissions={renderPermissions}
          renderSettings={renderSettings}
        />
      ) : environment ? (
        <HostAgentLaunchSettings
          key={`${environmentId}:${environment.pairingRevision ?? environment.createdAt}`}
          environmentId={environmentId}
          pairingRevision={environment.pairingRevision ?? environment.createdAt}
          hostName={environment.name}
          renderPermissions={renderPermissions}
          renderSettings={renderSettings}
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          {translate('settings.agents.loadingHost', 'Loading agent settings…')}
        </p>
      )}
    </section>
  )
}

function LocalAgentLaunchSettings({
  settings,
  updateSettings,
  renderPermissions,
  renderSettings
}: {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void | Promise<void>
  renderPermissions: AgentPermissionsRenderer
  renderSettings?: AgentLaunchSettingsRenderer
}): React.JSX.Element {
  const tail = useRef<Promise<void> | null>(null)
  const mutate = (mutation: AgentLaunchSettingsMutation): Promise<void> => {
    const write = (tail.current ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        const current = useAppStore.getState().settings ?? settings
        const platform = getRendererAppPlatform()
        await updateSettings(agentLaunchSettingsMutationUpdates(current, mutation, platform))
      })
    tail.current = write
    return write
  }
  if (renderSettings) {
    return <>{renderSettings(projectAgentLaunchSettings(settings), mutate)}</>
  }
  return (
    <AgentLaunchSettingsCatalog
      settings={projectAgentLaunchSettings(settings)}
      mutate={mutate}
      detectionTarget={LOCAL_DETECTION_TARGET}
      hostName={null}
      renderPermissions={renderPermissions}
      local={{ settings, updateSettings }}
    />
  )
}

const LOCAL_DETECTION_TARGET = { kind: 'local' } as const
