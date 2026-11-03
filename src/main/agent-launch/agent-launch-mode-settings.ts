import { normalizeNativeChatProviders } from '../../shared/structured-native-chat-launch-route'
import { TUI_AGENT_CONFIG } from '../../shared/tui-agent-config'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import type { AgentLaunchModeSettings } from './agent-launch-mode'

/** Missing settings remain unknown. A relaying client's typed preference belongs to this launch;
 *  it replaces the host's preference, but never supplies execution or rendering capability. */
export function readAgentLaunchModeSettings(
  runtime: Pick<OrcaRuntimeService, 'getClientSettings'>,
  nativeChatDefault?: boolean
): AgentLaunchModeSettings | null {
  if (nativeChatDefault !== undefined) {
    return typeof nativeChatDefault === 'boolean'
      ? {
          nativeChatProviders: Object.fromEntries(
            Object.keys(TUI_AGENT_CONFIG).map((agent) => [agent, nativeChatDefault])
          )
        }
      : null
  }
  try {
    const settings = runtime.getClientSettings()
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      return null
    }
    return {
      nativeChatProviders: normalizeNativeChatProviders(
        Object.hasOwn(settings, 'nativeChatProviders') ? settings.nativeChatProviders : undefined
      )
    }
  } catch {
    return null
  }
}
