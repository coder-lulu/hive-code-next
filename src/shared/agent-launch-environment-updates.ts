import type {
  AgentLaunchSettingsMutation,
  AgentLaunchSettingsSource
} from './agent-launch-settings'
import { normalizeTuiAgentEnvRecord } from './tui-agent-launch-defaults'

export function agentEnvironmentMutationUpdates(
  settings: AgentLaunchSettingsSource,
  mutation: Extract<
    AgentLaunchSettingsMutation,
    { type: 'environment-set' | 'environment-remove' }
  >,
  platform: NodeJS.Platform
): AgentLaunchSettingsSource {
  const env = { ...normalizeTuiAgentEnvRecord(settings.agentDefaultEnv)[mutation.agent] }
  for (const name of Object.keys(env)) {
    if (
      name === mutation.name ||
      (platform === 'win32' && name.toLowerCase() === mutation.name.toLowerCase())
    ) {
      delete env[name]
    }
  }
  if (mutation.type === 'environment-set') {
    env[mutation.name] = mutation.value
  }
  return { agentDefaultEnv: { ...settings.agentDefaultEnv, [mutation.agent]: env } }
}
