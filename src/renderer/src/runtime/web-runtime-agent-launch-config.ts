import {
  AGENT_SESSION_HOST_AUTHORITY_CAPABILITY,
  AGENT_SESSION_LAUNCH_PERMISSION_CAPABILITY
} from '../../../shared/agent-session-host-authority'
import type { TuiAgent } from '../../../shared/tui-agent'
import type { AgentExplicitLaunchPermissionMode } from '../../../shared/tui-agent-permissions'
import { useAppStore } from '../store'
import { agentResumeHostAuthorityCapability } from './agent-resume-host-authority-capability'
import { toWebTerminalSurfaceTabId } from './web-terminal-surface-id'

export function resolveWebRuntimeAgentHostAuthorityCapabilities(args: {
  agent: TuiAgent
  agentSessionKind: 'fresh' | 'resume' | undefined
  agentPermissionMode: AgentExplicitLaunchPermissionMode | undefined
}): string[] {
  const resumeCapability =
    args.agentSessionKind === 'resume' ? agentResumeHostAuthorityCapability(args.agent) : undefined
  return [
    AGENT_SESSION_HOST_AUTHORITY_CAPABILITY,
    ...(resumeCapability ? [resumeCapability] : []),
    ...(args.agentPermissionMode ? [AGENT_SESSION_LAUNCH_PERMISSION_CAPABILITY] : [])
  ].filter((capability, index, capabilities) => capabilities.indexOf(capability) === index)
}

export function registerWebRuntimeAgentLaunchConfig(args: {
  agent: TuiAgent | undefined
  agentArgs: string | null | undefined
  agentPermissionMode: AgentExplicitLaunchPermissionMode | undefined
  tabId: string | undefined
  leafId: string | undefined
  terminalHandle: string | undefined
}): void {
  if (
    !args.agent ||
    !args.agentPermissionMode ||
    !args.tabId ||
    !args.leafId ||
    !args.terminalHandle
  ) {
    return
  }
  const mirroredTabId = toWebTerminalSurfaceTabId(args.tabId)
  useAppStore.getState().registerAgentLaunchConfig(
    `${mirroredTabId}:${args.leafId}`,
    {
      agentArgs: args.agentArgs ?? '',
      agentEnv: {},
      hostDefaultsAuthoritative: true,
      agentPermissionMode: args.agentPermissionMode
    },
    {
      agentType: args.agent,
      tabId: mirroredTabId,
      leafId: args.leafId,
      terminalHandle: args.terminalHandle
    }
  )
}
