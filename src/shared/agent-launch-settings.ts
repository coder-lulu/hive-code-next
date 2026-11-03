import { permissionUpdates } from './agent-launch-permission-updates'
import { agentEnvironmentMutationUpdates } from './agent-launch-environment-updates'
import type { GlobalSettings } from './global-settings-types'
import type { TuiAgent } from './tui-agent'
import { buildDefaultAgentSettingsUpdate } from './default-agent-settings'
import {
  buildAgentAvailabilitySettingsUpdate,
  normalizeDisabledTuiAgents
} from './tui-agent-selection'
import { normalizeTuiAgentArgsRecord } from './tui-agent-launch-defaults'
import {
  isAgentPermissionChoice,
  normalizeAgentPermissionOverrides,
  type AgentPermissionChoice
} from './tui-agent-permission-choice'

export type AgentLaunchSettingsSource = Partial<
  Pick<
    GlobalSettings,
    | 'defaultTuiAgent'
    | 'newWorkspaceSetupOnly'
    | 'disabledTuiAgents'
    | 'agentCmdOverrides'
    | 'agentDefaultArgs'
    | 'agentDefaultEnv'
    | 'agentPermissionDefault'
    | 'agentPermissionOverrides'
  >
>

export type AgentLaunchSettings = {
  defaultTuiAgent: GlobalSettings['defaultTuiAgent']
  newWorkspaceSetupOnly?: boolean
  disabledTuiAgents: TuiAgent[]
  agentCmdOverrides: NonNullable<GlobalSettings['agentCmdOverrides']>
  agentDefaultArgs: NonNullable<GlobalSettings['agentDefaultArgs']>
  environmentNames: Partial<Record<TuiAgent, string[]>>
  agentPermissionDefault: AgentPermissionChoice
  agentPermissionOverrides: NonNullable<GlobalSettings['agentPermissionOverrides']>
}

export type AgentLaunchSettingsMutation =
  | { type: 'default'; agent: GlobalSettings['defaultTuiAgent']; setupOnly?: boolean }
  | { type: 'availability'; agent: TuiAgent; enabled: boolean }
  | { type: 'permissions'; agent?: TuiAgent; mode: AgentPermissionChoice | 'default' }
  | { type: 'command'; agent: TuiAgent; value: string }
  | { type: 'arguments'; agent: TuiAgent; value: string }
  | { type: 'environment-set'; agent: TuiAgent; name: string; value: string }
  | { type: 'environment-remove'; agent: TuiAgent; name: string }

export function projectAgentLaunchSettings(
  settings: AgentLaunchSettingsSource
): AgentLaunchSettings {
  assertKnownSettings(settings)
  return {
    defaultTuiAgent: settings.defaultTuiAgent ?? null,
    newWorkspaceSetupOnly: false,
    disabledTuiAgents: normalizeDisabledTuiAgents(settings.disabledTuiAgents),
    agentCmdOverrides: { ...settings.agentCmdOverrides },
    agentDefaultArgs: normalizeTuiAgentArgsRecord(settings.agentDefaultArgs),
    environmentNames: Object.fromEntries(
      Object.entries(settings.agentDefaultEnv ?? {}).map(([agent, env]) => [
        agent,
        Object.keys(env ?? {}).sort()
      ])
    ),
    agentPermissionDefault: isAgentPermissionChoice(settings.agentPermissionDefault)
      ? settings.agentPermissionDefault
      : 'own',
    agentPermissionOverrides: normalizeAgentPermissionOverrides(settings.agentPermissionOverrides)
  }
}

export function agentLaunchSettingsMutationUpdates(
  settings: AgentLaunchSettingsSource,
  mutation: AgentLaunchSettingsMutation,
  platform: NodeJS.Platform
): AgentLaunchSettingsSource {
  assertKnownSettings(settings)
  switch (mutation.type) {
    case 'default':
      return buildDefaultAgentSettingsUpdate(mutation.agent)
    case 'availability':
      return buildAgentAvailabilitySettingsUpdate(
        {
          defaultTuiAgent: settings.defaultTuiAgent ?? null,
          disabledTuiAgents: settings.disabledTuiAgents ?? []
        },
        mutation.agent,
        mutation.enabled
      )
    case 'permissions':
      return permissionUpdates(settings, mutation)
    case 'command': {
      const commands = { ...settings.agentCmdOverrides }
      if (mutation.value.trim()) {
        commands[mutation.agent] = mutation.value.trim()
      } else {
        delete commands[mutation.agent]
      }
      return { agentCmdOverrides: commands }
    }
    case 'arguments':
      return {
        agentDefaultArgs: normalizeTuiAgentArgsRecord({
          ...settings.agentDefaultArgs,
          [mutation.agent]: mutation.value
        })
      }
    case 'environment-set':
    case 'environment-remove':
      return agentEnvironmentMutationUpdates(settings, mutation, platform)
  }
}

function assertKnownSettings(settings: AgentLaunchSettingsSource): void {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    throw new Error('settings_unavailable')
  }
}
