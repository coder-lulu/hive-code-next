import type { AgentPermissionChoice } from '../../shared/tui-agent-permission-choice'
import type { AgentStartupShell } from '../../shared/tui-agent-startup-shell'
import type { TuiAgent } from '../../shared/tui-agent'
import { resolveTuiAgentLaunchPermission } from '../../shared/tui-agent-permissions'

export function withAgentSessionAccountEnv(
  env: Record<string, string> | undefined,
  accountEnv: Readonly<Record<string, string>> | undefined,
  permission?: { agent: TuiAgent; choice: AgentPermissionChoice; shell: AgentStartupShell }
): Record<string, string> | undefined {
  const merged = accountEnv && Object.keys(accountEnv).length > 0 ? { ...env, ...accountEnv } : env
  if (!merged || !permission || permission.choice === 'own') {
    return merged
  }
  return resolveTuiAgentLaunchPermission({
    agent: permission.agent,
    mode:
      permission.choice === 'full-access'
        ? 'yolo'
        : permission.choice === 'auto'
          ? 'auto'
          : 'manual',
    agentEnv: merged,
    shell: permission.shell
  }).agentEnv
}
