import type { SleepingAgentLaunchConfig } from './agent-session-resume'
import type { AgentLaunchPermissionMode } from './tui-agent-permissions'

export function buildSleepingAgentLaunchConfig(args: {
  agentCommand?: string | null
  agentArgs?: string | null
  agentEnv?: Record<string, string> | null
  ompResumeFilePath?: string | null
  hostDefaultsAuthoritative?: true
  agentPermissionMode?: AgentLaunchPermissionMode
}): SleepingAgentLaunchConfig {
  return {
    ...(args.agentCommand?.trim() ? { agentCommand: args.agentCommand } : {}),
    agentArgs: args.agentArgs ?? '',
    // Startup env may contain prompt/pane transport; persist only Orca-managed launch inputs.
    agentEnv: args.agentEnv ? { ...args.agentEnv } : {},
    ...(args.ompResumeFilePath?.trim() ? { ompResumeFilePath: args.ompResumeFilePath.trim() } : {}),
    ...(args.hostDefaultsAuthoritative ? { hostDefaultsAuthoritative: true as const } : {}),
    ...(args.agentPermissionMode && args.agentPermissionMode !== 'default'
      ? { agentPermissionMode: args.agentPermissionMode }
      : {})
  }
}
