import { describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { FLOATING_WORKSPACE_WORKTREE_ID } from './floating-workspace'
import { loadMobileNewTabAgentOptions } from './mobile-new-tab-agent-loader'

function createClient(
  handler: (method: string, params?: unknown) => Promise<unknown>
): RpcClient & { sendRequest: ReturnType<typeof vi.fn> } {
  return {
    sendRequest: vi.fn(handler),
    subscribe: vi.fn(() => () => {})
  } as unknown as RpcClient & { sendRequest: ReturnType<typeof vi.fn> }
}

describe('mobile new-tab agent loading', () => {
  it.each([null, 'ssh-folder'])(
    'detects agents on the folder execution target %s',
    async (connectionId) => {
      const client = createClient(async (method, params) => {
        if (method === 'settings.get') {
          return { ok: true, result: { settings: { disabledTuiAgents: ['claude'] } } }
        }
        if (method === 'folderWorkspace.list') {
          return { ok: true, result: { folderWorkspaces: [{ id: 'folder-1', connectionId }] } }
        }
        if (method === (connectionId ? 'preflight.detectRemoteAgents' : 'preflight.detectAgents')) {
          expect(params).toEqual(connectionId ? { connectionId } : undefined)
          return { ok: true, result: ['claude', 'codex'] }
        }
        throw new Error(`unexpected request: ${method}`)
      })
      await expect(
        loadMobileNewTabAgentOptions({ client, worktreeId: 'folder:folder-1' })
      ).resolves.toEqual([{ agent: 'codex', label: 'Codex' }])
      expect(client.sendRequest).not.toHaveBeenCalledWith('repo.list')
    }
  )

  it('does not detect agents locally when the folder target cannot be resolved', async () => {
    const client = createClient(async (method) => {
      if (method === 'settings.get') {
        return { ok: true, result: { settings: {} } }
      }
      if (method === 'folderWorkspace.list') {
        return { ok: true, result: { folderWorkspaces: [] } }
      }
      throw new Error(`unexpected request: ${method}`)
    })
    await expect(
      loadMobileNewTabAgentOptions({ client, worktreeId: 'folder:missing' })
    ).rejects.toThrow('workspace_not_found')
    expect(client.sendRequest).not.toHaveBeenCalledWith('preflight.detectAgents')
  })

  it('detects agents locally for the floating workspace without listing repos', async () => {
    const client = createClient(async (method) => {
      if (method === 'settings.get') {
        return {
          ok: true,
          result: { settings: { defaultTuiAgent: 'codex', disabledTuiAgents: [] } }
        }
      }
      if (method === 'preflight.detectAgents') {
        return { ok: true, result: ['claude', 'codex'] }
      }
      throw new Error(`unexpected request: ${method}`)
    })

    await expect(
      loadMobileNewTabAgentOptions({
        client,
        worktreeId: FLOATING_WORKSPACE_WORKTREE_ID
      })
    ).resolves.toEqual([
      { agent: 'codex', label: 'Codex' },
      { agent: 'claude', label: 'Claude' }
    ])
    expect(client.sendRequest.mock.calls.map(([method]) => method)).toEqual([
      'preflight.detectAgents',
      'settings.get'
    ])
  })

  it('detects agents through the worktree repo connection for SSH sessions', async () => {
    const client = createClient(async (method, params) => {
      if (method === 'settings.get') {
        return { ok: true, result: { settings: {} } }
      }
      if (method === 'repo.list') {
        return { ok: true, result: { repos: [{ id: 'repo-1', connectionId: 'ssh-1' }] } }
      }
      if (method === 'preflight.detectRemoteAgents') {
        expect(params).toEqual({ connectionId: 'ssh-1' })
        return { ok: true, result: ['claude'] }
      }
      throw new Error(`unexpected request: ${method}`)
    })

    await expect(
      loadMobileNewTabAgentOptions({
        client,
        worktreeId: 'repo-1::/remote/worktree'
      })
    ).resolves.toEqual([{ agent: 'claude', label: 'Claude' }])
    expect(client.sendRequest.mock.calls.map(([method]) => method)).toEqual([
      'repo.list',
      'settings.get',
      'preflight.detectRemoteAgents'
    ])
  })
})
