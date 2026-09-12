import type { RuntimeMobileSessionCreateTerminalResult } from '../../../src/shared/runtime-types'
import { MAX_QUICK_COMMAND_AGENT_PROMPT_LENGTH } from '../../../src/shared/terminal-quick-commands'
import type { TuiAgent } from '../../../src/shared/tui-agent'
import { FLOATING_WORKSPACE_WORKTREE_ID } from '../session/floating-workspace'
import { z } from 'zod'
import {
  defineRpcOperation,
  runRpcOperation,
  type RpcOperationClient
} from '../transport/rpc-operation'
import { rpcResultVariant } from '../transport/rpc-operation-result-reader'

const MAX_CLIENT_MUTATION_ID_LENGTH = 128

const createdTerminalShape = z.object({
  tab: z
    .object({
      type: z.literal('terminal'),
      id: z.string().min(1),
      title: z.string(),
      parentTabId: z.string(),
      leafId: z.string(),
      isActive: z.boolean()
    })
    .and(
      z.discriminatedUnion('status', [
        z.object({ status: z.literal('pending-handle'), terminal: z.null() }),
        z.object({ status: z.literal('ready'), terminal: z.string().min(1) })
      ])
    ),
  publicationEpoch: z.string().min(1),
  snapshotVersion: z.number().int().nonnegative()
})

const createHomeTerminal = defineRpcOperation({
  name: 'home.createSelectedAgentTerminal',
  method: 'session.tabs.createTerminal',
  acceptance: 'require-result-or-throw',
  barrier: 'on-settle',
  read: rpcResultVariant(
    'created',
    z.custom<RuntimeMobileSessionCreateTerminalResult>(
      (value) => createdTerminalShape.safeParse(value).success
    )
  )
})

export type MobileHomeAgentTerminalCreateInput = {
  client: RpcOperationClient
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

  return runRpcOperation(client, createHomeTerminal, {
    worktree: `id:${FLOATING_WORKSPACE_WORKTREE_ID}`,
    agent,
    agentPrompt: normalizedPrompt,
    clientMutationId: normalizedMutationId,
    activate: false,
    select: true,
    navigation: 'caller'
  })
}
