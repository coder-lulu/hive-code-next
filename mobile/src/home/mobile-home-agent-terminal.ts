import type { RuntimeMobileSessionCreateTerminalResult } from '../../../src/shared/runtime-types'
import { MAX_QUICK_COMMAND_AGENT_PROMPT_LENGTH } from '../../../src/shared/terminal-quick-commands'
import type { TuiAgent } from '../../../src/shared/tui-agent'
import { FLOATING_WORKSPACE_WORKTREE_ID } from '../session/floating-workspace'
import type { RpcClient } from '../transport/rpc-client'

const MAX_CLIENT_MUTATION_ID_LENGTH = 128

export type MobileHomeAgentTerminalCreateInput = {
  client: Pick<RpcClient, 'sendRequest'>
  agent: TuiAgent
  prompt: string
  /**
   * Caller-owned so an ambiguous transport retry can reuse the same id and let
   * the Runtime return the original terminal instead of starting another one.
   */
  clientMutationId: string
}

/** Create once per user submit and retain the value until that submit settles. */
export function createMobileHomeAgentTerminalMutationId(): string {
  return `mobile-home-agent:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export async function createMobileHomeAgentTerminal({
  agent,
  client,
  clientMutationId,
  prompt
}: MobileHomeAgentTerminalCreateInput): Promise<RuntimeMobileSessionCreateTerminalResult> {
  const normalizedPrompt = prompt.trim()
  if (!normalizedPrompt) {
    throw new Error('Agent prompt cannot be empty')
  }
  if (normalizedPrompt.length > MAX_QUICK_COMMAND_AGENT_PROMPT_LENGTH) {
    throw new Error(
      `Agent prompt cannot exceed ${MAX_QUICK_COMMAND_AGENT_PROMPT_LENGTH} characters`
    )
  }

  const normalizedMutationId = clientMutationId.trim()
  if (!normalizedMutationId) {
    throw new Error('Client mutation id cannot be empty')
  }
  if (normalizedMutationId.length > MAX_CLIENT_MUTATION_ID_LENGTH) {
    throw new Error(`Client mutation id cannot exceed ${MAX_CLIENT_MUTATION_ID_LENGTH} characters`)
  }

  const response = await client.sendRequest('session.tabs.createTerminal', {
    worktree: `id:${FLOATING_WORKSPACE_WORKTREE_ID}`,
    agent,
    agentPrompt: normalizedPrompt,
    clientMutationId: normalizedMutationId,
    activate: false,
    select: true,
    navigation: 'caller'
  })
  if (!response.ok) {
    throw new Error(response.error.message || 'Failed to create agent terminal')
  }
  return response.result as RuntimeMobileSessionCreateTerminalResult
}
