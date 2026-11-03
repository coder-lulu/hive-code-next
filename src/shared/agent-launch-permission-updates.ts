import type {
  AgentLaunchSettingsMutation,
  AgentLaunchSettingsSource
} from './agent-launch-settings'
import { isTuiAgent } from './tui-agent-config'
import {
  applyAgentPermissionOverrides,
  agentPermissionChoices,
  isAgentPermissionChoice,
  applyAllAgentsPermission
} from './tui-agent-permission-choice'
import { normalizeTuiAgentEnvRecord } from './tui-agent-launch-defaults'
import type { TuiAgent } from './tui-agent'

/** Only an explicit typed choice changes the permission policy. */
export function permissionUpdates(
  settings: AgentLaunchSettingsSource,
  mutation: Extract<AgentLaunchSettingsMutation, { type: 'permissions' }>
): AgentLaunchSettingsSource {
  if (mutation.agent !== undefined) {
    if (
      !isTuiAgent(mutation.agent) ||
      (mutation.mode !== 'default' &&
        !agentPermissionChoices(mutation.agent).includes(mutation.mode))
    ) {
      throw new Error('Unsupported agent permission choice')
    }
    return applyAgentPermissionOverrides(settings, [mutation.agent], mutation.mode)
  }
  if (!isAgentPermissionChoice(mutation.mode)) {
    throw new Error('Choose a permission for all agents')
  }
  return applyAllAgentsPermission(settings, mutation.mode)
}

/** Environment text remains terminal configuration, never an implicit permission grant. */
export function wholeAgentEnvironmentUpdates(
  settings: AgentLaunchSettingsSource,
  agent: TuiAgent,
  requested: Record<string, string>,
  platform: NodeJS.Platform
): AgentLaunchSettingsSource {
  let requestedEnv = requested
  if (platform === 'win32') {
    const spellings = new Map<string, [string, string]>()
    for (const entry of Object.entries(requested)) {
      const identity = entry[0].trim().toLowerCase()
      spellings.delete(identity)
      spellings.set(identity, entry)
    }
    requestedEnv = Object.fromEntries(spellings.values())
  }
  const env = normalizeTuiAgentEnvRecord({ [agent]: requestedEnv })[agent] ?? {}
  const previous = settings.agentDefaultEnv?.[agent] ?? {}
  const entries = Object.entries(env)
  if (
    entries.length === Object.keys(previous).length &&
    entries.every(([name, value]) => Object.hasOwn(previous, name) && previous[name] === value)
  ) {
    return {}
  }
  return { agentDefaultEnv: { ...settings.agentDefaultEnv, [agent]: env } }
}
