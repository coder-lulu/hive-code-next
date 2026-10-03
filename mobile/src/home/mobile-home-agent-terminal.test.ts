import { describe, expect, it, vi } from 'vitest'
import { MAX_QUICK_COMMAND_AGENT_PROMPT_LENGTH } from '../../../src/shared/terminal-quick-commands'
import type { RpcResponse } from '../transport/types'
import {
  createMobileHomeAgentTerminal,
  createMobileHomeAgentTerminalMutationId
} from './mobile-home-agent-terminal'

function terminalResult() {
  return {
    tab: {
      type: 'terminal',
      id: 'tab-1',
      title: 'Agent',
      parentTabId: 'tab-1',
      leafId: 'leaf-1',
      isActive: true,
      status: 'pending-handle',
      terminal: null
    },
    publicationEpoch: 'epoch-1',
    snapshotVersion: 1
  }
}

function success(result: unknown = terminalResult()): RpcResponse {
  return { id: 'request', ok: true, result, _meta: { runtimeId: 'runtime' } }
}

function failure(message: string): RpcResponse {
  return {
    id: 'request',
    ok: false,
    error: { code: 'create_failed', message },
    _meta: { runtimeId: 'runtime' }
  }
}

function clientReturning(response: RpcResponse) {
  return { sendRequest: vi.fn(async () => response) }
}

describe('mobile home agent terminal creation', () => {
  it('atomically creates a selected agent in the floating workspace with the normalized prompt', async () => {
    const result = terminalResult()
    const client = clientReturning(success(result))

    await expect(
      createMobileHomeAgentTerminal({
        client,
        agent: 'codex',
        prompt: '  Review this diff  ',
        clientMutationId: '  submit-1  '
      })
    ).resolves.toBe(result)

    expect(client.sendRequest).toHaveBeenCalledOnce()
    expect(client.sendRequest).toHaveBeenCalledWith(
      'session.tabs.createTerminal',
      {
        worktree: 'id:global-floating-terminal',
        agent: 'codex',
        agentPrompt: 'Review this diff',
        clientMutationId: 'submit-1',
        activate: false,
        select: true,
        navigation: 'caller'
      },
      undefined
    )
  })

  it.each(['', ' ', '\n\t'])(
    'rejects an empty normalized prompt without an RPC (%j)',
    async (prompt) => {
      const client = clientReturning(success())

      await expect(
        createMobileHomeAgentTerminal({
          client,
          agent: 'codex',
          prompt,
          clientMutationId: 'submit-1'
        })
      ).rejects.toThrow('Agent prompt cannot be empty')
      expect(client.sendRequest).not.toHaveBeenCalled()
    }
  )

  it('accepts 6000 prompt characters and rejects 6001 before making an RPC', async () => {
    const client = clientReturning(success())
    const maximumPrompt = 'x'.repeat(MAX_QUICK_COMMAND_AGENT_PROMPT_LENGTH)

    await createMobileHomeAgentTerminal({
      client,
      agent: 'claude',
      prompt: maximumPrompt,
      clientMutationId: 'maximum-prompt'
    })
    expect(client.sendRequest).toHaveBeenCalledWith(
      'session.tabs.createTerminal',
      expect.objectContaining({ agentPrompt: maximumPrompt }),
      undefined
    )

    client.sendRequest.mockClear()
    await expect(
      createMobileHomeAgentTerminal({
        client,
        agent: 'claude',
        prompt: `${maximumPrompt}x`,
        clientMutationId: 'overlong-prompt'
      })
    ).rejects.toThrow(
      `Agent prompt cannot exceed ${MAX_QUICK_COMMAND_AGENT_PROMPT_LENGTH} characters`
    )
    expect(client.sendRequest).not.toHaveBeenCalled()
  })

  it.each([
    ['', 'Client mutation id cannot be empty'],
    [' '.repeat(3), 'Client mutation id cannot be empty'],
    ['x'.repeat(129), 'Client mutation id cannot exceed 128 characters']
  ])('rejects an invalid client mutation id without an RPC', async (clientMutationId, message) => {
    const client = clientReturning(success())

    await expect(
      createMobileHomeAgentTerminal({
        client,
        agent: 'codex',
        prompt: 'Review this diff',
        clientMutationId
      })
    ).rejects.toThrow(message)
    expect(client.sendRequest).not.toHaveBeenCalled()
  })

  it('keeps a caller-owned mutation id stable across an ambiguous retry', async () => {
    const client = clientReturning(success())
    const input = {
      client,
      agent: 'codex' as const,
      prompt: 'Review this diff',
      clientMutationId: 'stable-submit-id'
    }

    await createMobileHomeAgentTerminal(input)
    await createMobileHomeAgentTerminal(input)

    expect(client.sendRequest).toHaveBeenCalledTimes(2)
    for (const [, params] of client.sendRequest.mock.calls) {
      expect(params).toEqual(expect.objectContaining({ clientMutationId: 'stable-submit-id' }))
    }
  })

  it('surfaces the Runtime failure without issuing a fallback terminal.send', async () => {
    const client = clientReturning(failure('Selected agent is disabled'))

    await expect(
      createMobileHomeAgentTerminal({
        client,
        agent: 'codex',
        prompt: 'Review this diff',
        clientMutationId: 'submit-1'
      })
    ).rejects.toThrow('Selected agent is disabled')
    expect(client.sendRequest).toHaveBeenCalledOnce()
    expect(client.sendRequest.mock.calls.map(([method]) => method)).toEqual([
      'session.tabs.createTerminal'
    ])
  })

  it('creates compact mutation ids that fit the Runtime contract', () => {
    const clientMutationId = createMobileHomeAgentTerminalMutationId()

    expect(clientMutationId).toMatch(/^mobile-home-agent:[a-z0-9]+-[a-z0-9]+$/)
    expect(clientMutationId.length).toBeLessThanOrEqual(128)
  })

  it('rejects an incompatible admitted creation reply without retrying the mutation', async () => {
    const client = clientReturning(success({ tab: { id: 'tab-1' } }))
    await expect(
      createMobileHomeAgentTerminal({
        client,
        agent: 'codex',
        prompt: 'Inspect',
        clientMutationId: 'submit-invalid'
      })
    ).rejects.toThrow('The host sent a reply this app could not read (session.tabs.createTerminal)')
    expect(client.sendRequest).toHaveBeenCalledOnce()
  })
})
