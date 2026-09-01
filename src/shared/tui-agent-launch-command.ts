import {
  removeOverriddenAgentSessionArgs,
  resolveAgentSessionOptionLaunch
} from './agent-session-option-launch'
import type { SessionOptionValue } from './native-chat-session-options'
import { getTuiAgentLaunchCommand, TUI_AGENT_CONFIG } from './tui-agent-config'
import {
  planAgentCliArgsSuffix,
  quoteStartupArg,
  tokenizeStartupCommand,
  withoutEnvCommand,
  type AgentStartupShell
} from './tui-agent-startup-shell'
import type { TuiAgent } from './tui-agent'
import {
  resolveTuiAgentLaunchPermission,
  supportsTuiAgentLaunchPermission,
  YOLO_TUI_AGENT_ENV,
  type AgentLaunchPermissionMode
} from './tui-agent-permissions'
import { rewriteAgentCommandOverridePermission } from './tui-agent-permission-command'

export type ResolvedAgentLaunchCommand =
  | {
      ok: true
      command: string
      commandWithoutSessionOptions: string
      appliedSessionOptions: Record<string, SessionOptionValue>
    }
  | { ok: false; error: string }

export function resolveAgentLaunchCommand(args: {
  agent: TuiAgent
  cmdOverrides: Partial<Record<TuiAgent, string>>
  platform: NodeJS.Platform
  shell: AgentStartupShell
  agentArgs?: string | null
  sessionOptions?: Record<string, SessionOptionValue>
  sessionOptionsOverrideAgentArgs?: boolean
  isRemote?: boolean
  agentPermissionMode?: AgentLaunchPermissionMode
}): ResolvedAgentLaunchCommand {
  const permissionMode = args.agentPermissionMode ?? 'default'
  if (permissionMode !== 'default' && !supportsTuiAgentLaunchPermission(args.agent)) {
    return { ok: false, error: 'This agent does not support an explicit launch permission mode.' }
  }
  let override = args.cmdOverrides[args.agent]
  let agentArgs = resolveTuiAgentLaunchPermission({
    agent: args.agent,
    mode: permissionMode,
    agentArgs: args.agentArgs,
    shell: args.shell
  }).agentArgs
  if (override && permissionMode !== 'default') {
    const permissionEnvNames = Object.keys(YOLO_TUI_AGENT_ENV[args.agent] ?? {})
    const rewritten = rewriteAgentCommandOverridePermission({
      agent: args.agent,
      mode: permissionMode,
      commandOverride: override,
      agentArgs,
      permissionEnvNames,
      shell: args.shell
    })
    if (!rewritten.ok) {
      return rewritten
    }
    override = rewritten.commandOverride
    agentArgs = rewritten.agentArgs
  }
  const command =
    override ||
    getTuiAgentLaunchCommand(TUI_AGENT_CONFIG[args.agent], args.platform, {
      isRemote: args.isRemote
    })
  const permissionEnvNames =
    permissionMode === 'manual' ? Object.keys(YOLO_TUI_AGENT_ENV[args.agent] ?? {}) : []
  const permissionSafeCommand = withoutEnvCommand(permissionEnvNames, command, args.shell)
  const suffix = planAgentCliArgsSuffix(agentArgs, args.shell)
  if (!suffix.ok) {
    return suffix
  }
  const trailingTokens = agentArgs
    ? tokenizeStartupCommand(agentArgs, args.shell)
    : { ok: true as const, tokens: [], spans: [] }
  if (!trailingTokens.ok) {
    return { ok: false, error: `CLI arguments are invalid: ${trailingTokens.error}` }
  }
  const resolvedOptions = resolveAgentSessionOptionLaunch(
    args.agent,
    args.sessionOptions,
    args.sessionOptionsOverrideAgentArgs ? [] : trailingTokens.tokens,
    !args.sessionOptionsOverrideAgentArgs
  )
  if (override && args.sessionOptionsOverrideAgentArgs) {
    const overrideTokens = tokenizeStartupCommand(override, args.shell)
    if (!overrideTokens.ok) {
      return { ok: false, error: `Agent command override is invalid: ${overrideTokens.error}` }
    }
    const commandOverrideOptions = resolveAgentSessionOptionLaunch(
      args.agent,
      args.sessionOptions,
      overrideTokens.tokens,
      false
    )
    if (
      Object.entries(resolvedOptions.appliedValues).some(
        ([key, value]) => commandOverrideOptions.appliedValues[key] !== value
      )
    ) {
      return {
        ok: false,
        error:
          'Agent command override conflicts with the requested launch preferences. Remove model or effort flags from the command override.'
      }
    }
  }
  const optionSuffix = resolvedOptions.args.map((arg) => quoteStartupArg(arg, args.shell)).join(' ')
  const commandWithoutSessionOptions = suffix.suffix
    ? `${permissionSafeCommand} ${suffix.suffix}`
    : permissionSafeCommand
  const commandWithOptions = optionSuffix
    ? `${permissionSafeCommand} ${optionSuffix}`
    : permissionSafeCommand
  const overrideTokens = args.sessionOptionsOverrideAgentArgs
    ? insertBeforeTerminator(
        removeOverriddenAgentSessionArgs(args.agent, args.sessionOptions, trailingTokens.tokens),
        resolvedOptions.args
      )
    : []
  const commandWithOverrides = overrideTokens.length
    ? `${permissionSafeCommand} ${overrideTokens.map((token) => quoteStartupArg(token, args.shell)).join(' ')}`
    : permissionSafeCommand
  return {
    ok: true,
    command: args.sessionOptionsOverrideAgentArgs
      ? commandWithOverrides
      : suffix.suffix
        ? `${commandWithOptions} ${suffix.suffix}`
        : commandWithOptions,
    commandWithoutSessionOptions,
    appliedSessionOptions: resolvedOptions.appliedValues
  }
}

function insertBeforeTerminator(tokens: readonly string[], inserted: readonly string[]): string[] {
  const terminator = tokens.indexOf('--')
  if (terminator === -1) {
    return [...tokens, ...inserted]
  }
  return [...tokens.slice(0, terminator), ...inserted, ...tokens.slice(terminator)]
}
