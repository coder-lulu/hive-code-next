import type { NativeTeamTaskToolSession } from '../../shared/hive-team-task-tools'

export const CODEX_TEAM_TASK_TOOL_NAMES = new Set(['hive_team_task_start', 'hive_team_task_status'])
const MAX_BYTES = 64 * 1024

export function boundedTeamToolJson(value: unknown): string | null {
  let nodes = 0
  const visit = (entry: unknown, depth: number): boolean => {
    if (++nodes > 4096 || depth > 12) {
      return false
    }
    if (entry === null || typeof entry === 'boolean' || typeof entry === 'number') {
      return true
    }
    if (typeof entry === 'string') {
      return entry.length <= MAX_BYTES
    }
    if (typeof entry !== 'object') {
      return false
    }
    return Object.entries(entry).every(
      ([key, child]) => key.length <= 256 && visit(child, depth + 1)
    )
  }
  try {
    if (!visit(value, 0)) {
      return null
    }
    const encoded = JSON.stringify(value)
    return Buffer.byteLength(encoded, 'utf8') <= MAX_BYTES ? encoded : null
  } catch {
    return null
  }
}

export function validTeamToolCatalog(tools: NativeTeamTaskToolSession): boolean {
  return (
    tools.definitions.length === 2 &&
    new Set(tools.definitions.map((tool) => tool.name)).size === 2 &&
    tools.definitions.every(
      (tool) =>
        CODEX_TEAM_TASK_TOOL_NAMES.has(tool.name) &&
        typeof tool.description === 'string' &&
        tool.description.length <= 4096 &&
        tool.inputSchema?.type === 'object' &&
        boundedTeamToolJson(tool.inputSchema) !== null
    )
  )
}

export type CodexTeamToolCall = {
  threadId: string
  turnId: string
  callId: string
  tool: string
  arguments: unknown
}

export function parseTeamToolCall(params: unknown): CodexTeamToolCall | null {
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    return null
  }
  if (
    Object.keys(params).some(
      (key) => !['threadId', 'turnId', 'callId', 'tool', 'arguments', 'namespace'].includes(key)
    ) ||
    ('namespace' in params && params.namespace !== undefined && params.namespace !== null) ||
    !('threadId' in params) ||
    typeof params.threadId !== 'string' ||
    !('turnId' in params) ||
    typeof params.turnId !== 'string' ||
    !('callId' in params) ||
    typeof params.callId !== 'string' ||
    !('tool' in params) ||
    typeof params.tool !== 'string' ||
    ![params.threadId, params.turnId, params.callId, params.tool].every((value) =>
      /^[\w.-]{1,256}$/.test(value)
    ) ||
    !CODEX_TEAM_TASK_TOOL_NAMES.has(params.tool) ||
    !('arguments' in params) ||
    !Object.hasOwn(params, 'arguments') ||
    boundedTeamToolJson(params) === null
  ) {
    return null
  }
  return {
    threadId: params.threadId,
    turnId: params.turnId,
    callId: params.callId,
    tool: params.tool,
    arguments: params.arguments
  }
}

export function teamToolReply(success: boolean, value: Record<string, unknown>): object {
  const text = boundedTeamToolJson(value)
  return {
    success: text !== null && success,
    contentItems: [{ type: 'inputText', text: text ?? '{"error":"team_task_result_unavailable"}' }]
  }
}

export const TEAM_TOOL_DENIED = teamToolReply(false, { error: 'team_task_tool_unavailable' })
