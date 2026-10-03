import { TUI_AGENT_CONFIG } from './tui-agent-config'
import { matchingPermissionFormLength, rewritePermissionArgs } from './tui-agent-permission-args'
import {
  isPosixStartupShell,
  quoteStartupArg,
  tokenizeStartupCommand,
  type AgentStartupShell
} from './tui-agent-startup-shell'
import type { TuiAgent } from './tui-agent'
import {
  resolveTuiAgentPermissionArgForms,
  resolveTuiAgentPermissionTargetArgs,
  type AgentExplicitLaunchPermissionMode
} from './tui-agent-permissions'

export type PermissionCommandOverrideResult =
  | { ok: true; commandOverride: string; agentArgs: string }
  | { ok: false; error: string }

function executableName(value: string): string {
  return (value.split(/[\\/]/).pop() ?? '').replace(/\.(exe|cmd|bat|ps1)$/i, '').toLowerCase()
}

function isAgentExecutable(agent: TuiAgent, token: string): boolean {
  const config = TUI_AGENT_CONFIG[agent]
  const candidates = [config.detectCmd, ...(config.detectCmdAliases ?? [])]
  return candidates.some((candidate) => executableName(candidate) === executableName(token))
}

function findAgentExecutableIndex(
  agent: TuiAgent,
  tokens: readonly string[],
  shell: AgentStartupShell
): number {
  let commandPosition = true
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (commandPosition) {
      if (isAgentExecutable(agent, token)) {
        return index
      }
      if (
        (isPosixStartupShell(shell) && /^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) ||
        (shell === 'powershell' && index === 0 && token === '&')
      ) {
        continue
      }
      commandPosition = false
    }
    if (token === '--') {
      commandPosition = true
    }
  }
  return -1
}

function validateModelableCommand(
  command: string,
  shell: AgentStartupShell,
  tokenized: Extract<ReturnType<typeof tokenizeStartupCommand>, { ok: true }>
): string | null {
  for (let index = 0; index <= tokenized.tokens.length; index += 1) {
    const gapStart = index === 0 ? 0 : tokenized.spans[index - 1].end
    const gapEnd = index === tokenized.tokens.length ? command.length : tokenized.spans[index].start
    if (!/^[ \t]*$/.test(command.slice(gapStart, gapEnd))) {
      return 'Agent command override contains shell syntax that cannot safely apply a permission override.'
    }
    if (index === tokenized.tokens.length) {
      break
    }
    if (
      shell === 'powershell' &&
      command.slice(tokenized.spans[index].start, tokenized.spans[index].end) === '--%'
    ) {
      return 'Agent command override uses PowerShell stop-parsing syntax.'
    }
    if (tokenized.spans[index].divergesFromShell) {
      const safeCallOperator =
        shell === 'powershell' && index === 0 && tokenized.tokens[index] === '&'
      if (!safeCallOperator) {
        return 'Agent command override contains shell syntax that cannot safely apply a permission override.'
      }
    }
  }
  return null
}

function cutTokenRange(
  command: string,
  spans: readonly { start: number; end: number }[],
  startIndex: number,
  endIndex: number
): { start: number; end: number } {
  let start = spans[startIndex].start
  const previousEnd = startIndex === 0 ? 0 : spans[startIndex - 1].end
  while (start > previousEnd && ' \t'.includes(command[start - 1])) {
    start -= 1
  }
  return { start, end: spans[endIndex - 1].end }
}

function removeCuts(command: string, cuts: readonly { start: number; end: number }[]): string {
  const mergedCuts: { start: number; end: number }[] = []
  for (const cut of [...cuts].sort((left, right) => left.start - right.start)) {
    const previous = mergedCuts.at(-1)
    if (previous && cut.start <= previous.end) {
      previous.end = Math.max(previous.end, cut.end)
    } else {
      mergedCuts.push({ ...cut })
    }
  }
  let result = command
  for (let index = mergedCuts.length - 1; index >= 0; index -= 1) {
    result = `${result.slice(0, mergedCuts[index].start)}${result.slice(mergedCuts[index].end)}`
  }
  return result
}

export function rewriteAgentCommandOverridePermission(args: {
  agent: TuiAgent
  mode: AgentExplicitLaunchPermissionMode
  commandOverride: string
  agentArgs: string
  permissionEnvNames: readonly string[]
  shell: AgentStartupShell
}): PermissionCommandOverrideResult {
  const parsedCommand = tokenizeStartupCommand(args.commandOverride, args.shell)
  const parsedPermissionForms = resolveTuiAgentPermissionArgForms(args.agent).map((form) =>
    tokenizeStartupCommand(form, args.shell)
  )
  const parsedTargetPermission = tokenizeStartupCommand(
    resolveTuiAgentPermissionTargetArgs(args.agent, args.mode),
    args.shell
  )
  if (
    !parsedCommand.ok ||
    !parsedTargetPermission.ok ||
    parsedPermissionForms.some((parsed) => !parsed.ok)
  ) {
    return {
      ok: false,
      error: 'Agent command override cannot be safely parsed for permission mode.'
    }
  }
  const permissionTokenForms = parsedPermissionForms.flatMap((parsed) =>
    parsed.ok && parsed.tokens.length > 0 ? [parsed.tokens] : []
  )
  if (permissionTokenForms.length === 0 && args.permissionEnvNames.length === 0) {
    return {
      ok: false,
      error: 'Agent command override has no supported permission override.'
    }
  }
  const modelError = validateModelableCommand(args.commandOverride, args.shell, parsedCommand)
  if (modelError) {
    return { ok: false, error: modelError }
  }
  const executableIndex = findAgentExecutableIndex(args.agent, parsedCommand.tokens, args.shell)
  if (executableIndex === -1) {
    return {
      ok: false,
      error: 'Agent command override does not expose a recognizable agent executable.'
    }
  }
  const terminatorIndex = parsedCommand.tokens.indexOf('--', executableIndex + 1)
  const optionsEnd = terminatorIndex === -1 ? parsedCommand.tokens.length : terminatorIndex
  const cuts: { start: number; end: number }[] = []
  for (let index = executableIndex + 1; index < optionsEnd; ) {
    const matched = matchingPermissionFormLength(
      parsedCommand.tokens,
      index,
      optionsEnd,
      permissionTokenForms
    )
    if (matched > 0) {
      cuts.push(cutTokenRange(args.commandOverride, parsedCommand.spans, index, index + matched))
      index += matched
    } else {
      index += 1
    }
  }
  if (isPosixStartupShell(args.shell) && args.permissionEnvNames.length > 0) {
    for (let index = 0; index < executableIndex; index += 1) {
      if (
        args.permissionEnvNames.some((name) => parsedCommand.tokens[index].startsWith(`${name}=`))
      ) {
        cuts.push(cutTokenRange(args.commandOverride, parsedCommand.spans, index, index + 1))
      }
    }
  }

  const commandWithoutPermission = removeCuts(
    args.commandOverride,
    cuts.sort((left, right) => left.start - right.start)
  ).trim()
  const agentArgs =
    permissionTokenForms.length === 0
      ? args.agentArgs
      : rewritePermissionArgs({
          agentArgs: args.agentArgs,
          permissionArgForms: resolveTuiAgentPermissionArgForms(args.agent),
          targetPermissionArgs: '',
          shell: args.shell
        })
  if (agentArgs === null) {
    return { ok: false, error: 'Agent CLI arguments cannot be safely parsed for permission mode.' }
  }
  const normalized = tokenizeStartupCommand(commandWithoutPermission, args.shell)
  if (!normalized.ok) {
    return { ok: false, error: 'Agent command override cannot be normalized for permission mode.' }
  }
  const normalizedExecutable = findAgentExecutableIndex(args.agent, normalized.tokens, args.shell)
  const normalizedTerminator = normalized.tokens.indexOf('--', normalizedExecutable + 1)
  const quotedPermission = parsedTargetPermission.tokens
    .map((token) => quoteStartupArg(token, args.shell))
    .join(' ')
  if (!quotedPermission) {
    return { ok: true, commandOverride: commandWithoutPermission, agentArgs }
  }
  const commandOverride =
    normalizedTerminator === -1
      ? `${commandWithoutPermission} ${quotedPermission}`
      : `${commandWithoutPermission.slice(0, normalized.spans[normalizedTerminator].start)}${quotedPermission} ${commandWithoutPermission.slice(normalized.spans[normalizedTerminator].start)}`
  return { ok: true, commandOverride, agentArgs }
}
