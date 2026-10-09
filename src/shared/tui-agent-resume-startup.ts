import {
  getAgentResumeArgv,
  type AgentProviderSessionMetadata,
  type ResumableTuiAgent
} from './agent-session-resume'
import type { SessionOptionValue } from './native-chat-session-options'
import { buildSleepingAgentLaunchConfig } from './sleeping-agent-launch-config'
import { resolveAgentLaunchCommand } from './tui-agent-launch-command'
import type { AgentStartupPlan } from './tui-agent-startup'
import { resolveStartupShell, type AgentStartupShell } from './tui-agent-startup-shell'
import { TUI_AGENT_CONFIG } from './tui-agent-config'
import type { TuiAgent } from './tui-agent'
import { buildAgentResumeLaunchCommand } from './agent-resume-launch-command'
import {
  resolveTuiAgentLaunchPermission,
  type AgentLaunchPermissionMode
} from './tui-agent-permissions'

export function buildAgentResumeStartupPlan(args: {
  agent: ResumableTuiAgent
  providerSession: AgentProviderSessionMetadata
  cmdOverrides: Partial<Record<TuiAgent, string>>
  platform: NodeJS.Platform
  shell?: AgentStartupShell
  agentArgs?: string | null
  agentEnv?: Record<string, string> | null
  agentCommand?: string | null
  ompResumeFilePath?: string | null
  sessionOptions?: Record<string, SessionOptionValue>
  sessionOptionsOverrideAgentArgs?: boolean
  isRemote?: boolean
  agentPermissionMode?: AgentLaunchPermissionMode
  /** The caller chose the terminal folder on purpose, so Codex must not ask for the recorded one. */
  resumeInLaunchCwd?: boolean
}): AgentStartupPlan | null {
  const resumeArgv = getAgentResumeArgv(args.agent, args.providerSession, args.ompResumeFilePath)
  if (!resumeArgv) {
    return null
  }
  // Why: Codex otherwise prompts for the folder, defaulting to the recorded one even once it was
  // deleted (#17745). Kept before `resume` so dropAgentResumeArgvFromCommand strips only that.
  const argv =
    args.agent === 'codex' && args.resumeInLaunchCwd
      ? [resumeArgv[0], '-c', 'tui.resume_cwd=current', ...resumeArgv.slice(1)]
      : resumeArgv
  const shell = resolveStartupShell(args.platform, args.shell)
  const permissionConfig = resolveTuiAgentLaunchPermission({
    agent: args.agent,
    mode: args.agentPermissionMode ?? 'default',
    agentArgs: args.agentArgs,
    agentEnv: args.agentEnv,
    shell
  })
  const resolvedAgentCommand = args.agentCommand?.trim()
  const baseCommand = resolvedAgentCommand
    ? ({
        ok: true,
        command: resolvedAgentCommand,
        commandWithoutSessionOptions: resolvedAgentCommand,
        appliedSessionOptions: {}
      } as const)
    : resolveAgentLaunchCommand({
        agent: args.agent,
        cmdOverrides: args.cmdOverrides,
        platform: args.platform,
        shell,
        agentArgs: permissionConfig.agentArgs,
        sessionOptions: args.sessionOptions,
        sessionOptionsOverrideAgentArgs: args.sessionOptionsOverrideAgentArgs,
        isRemote: args.isRemote,
        agentPermissionMode: args.agentPermissionMode
      })
  if (!baseCommand.ok) {
    return null
  }
  const launchConfig = buildSleepingAgentLaunchConfig({
    ...args,
    agentArgs: permissionConfig.agentArgs,
    agentEnv: permissionConfig.agentEnv,
    agentCommand: baseCommand.commandWithoutSessionOptions
  })
  const launchCommand = buildAgentResumeLaunchCommand(args.agent, baseCommand.command, argv, shell)
  const applied = baseCommand.appliedSessionOptions
  return {
    agent: args.agent,
    launchCommand,
    expectedProcess: TUI_AGENT_CONFIG[args.agent].expectedProcess,
    followupPrompt: null,
    launchConfig,
    ...(args.agentPermissionMode && args.agentPermissionMode !== 'default'
      ? { agentPermissionMode: args.agentPermissionMode }
      : {}),
    ...(args.agent === 'codex' ? { startupCommandDelivery: 'shell-ready' as const } : {}),
    ...(Object.keys(applied).length > 0 ? { sessionOptions: { ...applied } } : {}),
    ...(Object.keys(permissionConfig.agentEnv).length > 0
      ? { env: { ...permissionConfig.agentEnv } }
      : {})
  }
}
