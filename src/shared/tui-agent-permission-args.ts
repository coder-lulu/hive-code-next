import {
  quoteStartupArg,
  tokenizeStartupCommand,
  type AgentStartupShell
} from './tui-agent-startup-shell'

function matchingPermissionLength(
  tokens: readonly string[],
  index: number,
  end: number,
  permissionTokens: readonly string[]
): number {
  if (permissionTokens.length === 0 || index >= end) {
    return 0
  }
  if (
    permissionTokens.every((token, offset) =>
      index + offset < end ? tokens[index + offset] === token : false
    )
  ) {
    return permissionTokens.length
  }
  const option = permissionTokens[0]
  if (permissionTokens.length === 1 && tokens[index].startsWith(`${option}=`)) {
    return 1
  }
  if (permissionTokens.length === 2) {
    if (tokens[index] === option && index + 1 < end) {
      return 2
    }
    if (tokens[index].startsWith(`${option}=`)) {
      return 1
    }
  }
  return 0
}

export function matchingPermissionFormLength(
  tokens: readonly string[],
  index: number,
  end: number,
  permissionTokenForms: readonly (readonly string[])[]
): number {
  for (const permissionTokens of permissionTokenForms) {
    const matched = matchingPermissionLength(tokens, index, end, permissionTokens)
    if (matched > 0) {
      return matched
    }
  }
  return 0
}

export function rewritePermissionArgs(args: {
  agentArgs: string
  permissionArgForms: readonly string[]
  targetPermissionArgs: string
  shell: AgentStartupShell
}): string | null {
  const parsedAgentArgs = tokenizeStartupCommand(args.agentArgs, args.shell)
  const parsedPermissionForms = args.permissionArgForms.map((form) =>
    tokenizeStartupCommand(form, args.shell)
  )
  const parsedTargetPermission = tokenizeStartupCommand(args.targetPermissionArgs, args.shell)
  if (
    !parsedAgentArgs.ok ||
    !parsedTargetPermission.ok ||
    parsedPermissionForms.some((parsed) => !parsed.ok)
  ) {
    return null
  }
  const permissionTokenForms = parsedPermissionForms.flatMap((parsed) =>
    parsed.ok && parsed.tokens.length > 0 ? [parsed.tokens] : []
  )
  const terminatorIndex = parsedAgentArgs.tokens.indexOf('--')
  const optionsEnd = terminatorIndex === -1 ? parsedAgentArgs.tokens.length : terminatorIndex
  const rewritten: string[] = []

  for (let index = 0; index < optionsEnd; ) {
    const matchedPermissionLength = matchingPermissionFormLength(
      parsedAgentArgs.tokens,
      index,
      optionsEnd,
      permissionTokenForms
    )
    if (matchedPermissionLength > 0) {
      index += matchedPermissionLength
      continue
    }
    rewritten.push(parsedAgentArgs.tokens[index])
    index += 1
  }

  rewritten.push(...parsedTargetPermission.tokens, ...parsedAgentArgs.tokens.slice(optionsEnd))
  return rewritten.map((token) => quoteStartupArg(token, args.shell)).join(' ')
}
