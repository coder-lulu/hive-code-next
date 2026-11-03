import {
  resolveTuiAgentLaunchPermission,
  type AgentLaunchPermissionMode
} from './tui-agent-permissions'
import {
  getAgentForkArgv,
  getAgentResumeArgv,
  type AgentProviderSessionMetadata,
  type ResumableTuiAgent
} from './agent-session-resume'
import type { SessionOptionValue } from './native-chat/input/native-chat-session-options'
import { buildSleepingAgentLaunchConfig } from './sleeping-agent-launch-config'
import { resolveAgentLaunchCommand, withAgentTerminalInputArgs } from './tui-agent-launch-command'
import type { AgentStartupPlan } from './tui-agent-startup'
import { resolveStartupShell, type AgentStartupShell } from './tui-agent-startup-shell'
import { TUI_AGENT_CONFIG } from './tui-agent-config'
import type { TuiAgent } from './tui-agent'
import { buildAgentResumeLaunchCommand } from './agent-resume-launch-command'
import { buildAiVaultResumeShellCommand } from './ai-vault-resume-command'
import { normalizeRuntimePathForComparison } from './cross-platform-path'
import { parseWslUncPath } from './wsl-paths'
import { dropRecordedAgentPermissionArgs } from './tui-agent-permission-lift'

export function buildAgentResumeStartupPlan(args: {
  agent: ResumableTuiAgent
  providerSession: AgentProviderSessionMetadata
  cmdOverrides: Partial<Record<TuiAgent, string>>
  platform: NodeJS.Platform
  shell?: AgentStartupShell
  agentPermissionMode?: AgentLaunchPermissionMode
  agentArgs?: string | null
  /** Current caller/settings arguments are user intent, rather than a recorded launch recipe. */
  agentArgsSource?: 'recorded' | 'current'
  agentEnv?: Record<string, string> | null
  agentCommand?: string | null
  ompResumeFilePath?: string | null
  sessionOptions?: Record<string, SessionOptionValue>
  sessionOptionsOverrideAgentArgs?: boolean
  isRemote?: boolean
  /** The caller chose the terminal folder on purpose, so Codex must not ask for the recorded one. */
  resumeInLaunchCwd?: boolean
  /** Folder the resume shell starts in; an agent recorded elsewhere is resumed from its own folder (#16960). */
  launchCwd?: string | null
  /** Open a copy of the conversation instead of re-entering it; null for agents that cannot. */
  fork?: boolean
  /** OS that runs the agent when `platform` only picks quoting; null when unreported. */
  agentHostPlatform?: NodeJS.Platform | null
}): AgentStartupPlan | null {
  const resumeArgv = args.fork
    ? getAgentForkArgv(args.agent, args.providerSession)
    : getAgentResumeArgv(args.agent, args.providerSession, args.ompResumeFilePath)
  if (!resumeArgv) {
    return null
  }
  // Codex otherwise asks for its old folder, even if deleted (#17745). Keep before resume so argv removal preserves the folder choice.
  const argv =
    args.agent === 'codex' && args.resumeInLaunchCwd
      ? [resumeArgv[0], '-c', 'tui.resume_cwd=current', ...resumeArgv.slice(1)]
      : resumeArgv
  const shell = resolveStartupShell(args.platform, args.shell)
  // Why: Codex restores a resumed thread's saved permissions unless the launch passes one, so
  // replaying Orca's launch-time flag would undo a change made inside the session (#10886).
  const recorded =
    args.agent === 'codex' && !args.fork
      ? dropRecordedAgentPermissionArgs(args.agent, args, shell)
      : args
  const agentArgs = args.agentArgsSource === 'current' ? args.agentArgs : recorded.agentArgs
  const permission = resolveTuiAgentLaunchPermission({
    agent: args.agent,
    mode: args.agentPermissionMode ?? 'default',
    agentArgs,
    agentEnv: args.agentEnv,
    shell
  })
  const resolvedAgentCommand = recorded.agentCommand?.trim()
  const baseCommand =
    resolvedAgentCommand && (!args.agentPermissionMode || args.agentPermissionMode === 'default')
      ? ({
          ok: true,
          command: withAgentTerminalInputArgs(
            resolvedAgentCommand,
            args.agent,
            args.agentHostPlatform === undefined ? args.platform : args.agentHostPlatform,
            shell
          ),
          resumeLaunch: { agentCommand: resolvedAgentCommand },
          appliedSessionOptions: {}
        } as const)
      : resolveAgentLaunchCommand({
          agent: args.agent,
          cmdOverrides: resolvedAgentCommand
            ? { ...args.cmdOverrides, [args.agent]: resolvedAgentCommand }
            : args.cmdOverrides,
          agentPermissionMode: args.agentPermissionMode,
          platform: args.platform,
          shell,
          agentArgs: resolvedAgentCommand ? undefined : permission.agentArgs,
          sessionOptions: args.sessionOptions,
          sessionOptionsOverrideAgentArgs: args.sessionOptionsOverrideAgentArgs,
          isRemote: args.isRemote,
          agentHostPlatform: args.agentHostPlatform
        })
  if (!baseCommand.ok) {
    return null
  }
  const launchConfig = buildSleepingAgentLaunchConfig({
    ...args,
    agentArgs,
    ...baseCommand.resumeLaunch
  })
  const resumeCommand = buildAgentResumeLaunchCommand(args.agent, baseCommand.command, argv, shell)
  const agentCwd = args.providerSession.cwd
  const launchCommand =
    agentCwd && args.launchCwd && !args.resumeInLaunchCwd && !isSameFolder(agentCwd, args.launchCwd)
      ? buildAiVaultResumeShellCommand({
          resumeCommand,
          cwd: agentCwd,
          platform: args.platform,
          shell
        })
      : resumeCommand
  const applied = baseCommand.appliedSessionOptions
  return {
    agent: args.agent,
    launchCommand,
    expectedProcess: TUI_AGENT_CONFIG[args.agent].expectedProcess,
    followupPrompt: null,
    launchConfig,
    ...(args.agent === 'codex' ? { startupCommandDelivery: 'shell-ready' as const } : {}),
    ...(Object.keys(applied).length > 0 ? { sessionOptions: { ...applied } } : {}),
    ...(args.agentEnv || args.agentPermissionMode ? { env: permission.agentEnv } : {})
  }
}

/** WSL panes start at a UNC path while the agent reports its Linux path. */
function isSameFolder(agentCwd: string, launchCwd: string): boolean {
  const launchPath = parseWslUncPath(launchCwd)?.linuxPath ?? launchCwd
  return (
    normalizeRuntimePathForComparison(agentCwd) === normalizeRuntimePathForComparison(launchPath)
  )
}
