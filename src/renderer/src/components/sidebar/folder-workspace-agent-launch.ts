import { CLIENT_PLATFORM } from '@/lib/new-workspace'
import { isWindowsAbsolutePathLike } from '../../../../shared/cross-platform-path'
import type { ProjectGroup } from '../../../../shared/project-group-types'
import type { TuiAgent } from '../../../../shared/tui-agent'
import {
  resolveTuiAgentLaunchPermission,
  type AgentLaunchPermissionMode
} from '../../../../shared/tui-agent-permissions'
import { resolveStartupShell } from '../../../../shared/tui-agent-startup-shell'
import { isWslUncPath } from '../../../../shared/wsl-paths'
import { resolveLocalWindowsAgentStartupShell } from '../../../../shared/windows-terminal-shell'

export function getFolderWorkspaceAgentLaunchPlatform(
  projectGroup: Pick<ProjectGroup, 'connectionId' | 'parentPath'>,
  isRemote = Boolean(projectGroup.connectionId)
): NodeJS.Platform {
  const parentPath = projectGroup.parentPath?.trim() ?? ''
  if (isRemote) {
    return isWindowsAbsolutePathLike(parentPath) ? 'win32' : 'linux'
  }
  return parentPath && isWslUncPath(parentPath) ? 'linux' : CLIENT_PLATFORM
}

export function resolveFolderWorkspaceAgentLaunch(args: {
  projectGroup: Pick<ProjectGroup, 'connectionId' | 'parentPath'>
  agent: TuiAgent | null
  permissionMode: AgentLaunchPermissionMode
  agentArgs?: string | null
  agentEnv?: Record<string, string>
  terminalWindowsShell?: string | null
  isRemote?: boolean
}): {
  platform: NodeJS.Platform
  shell: ReturnType<typeof resolveLocalWindowsAgentStartupShell>
  permissionConfig: { agentArgs: string; agentEnv: Record<string, string> } | null
} {
  const isRemote = args.isRemote ?? Boolean(args.projectGroup.connectionId)
  const platform = getFolderWorkspaceAgentLaunchPlatform(args.projectGroup, isRemote)
  const shell = resolveLocalWindowsAgentStartupShell({
    platform,
    isRemote,
    terminalWindowsShell: args.terminalWindowsShell
  })
  const permissionConfig = args.agent
    ? resolveTuiAgentLaunchPermission({
        agent: args.agent,
        mode: args.permissionMode,
        agentArgs: args.agentArgs,
        agentEnv: args.agentEnv,
        shell: resolveStartupShell(platform, shell)
      })
    : null
  return { platform, shell, permissionConfig }
}
