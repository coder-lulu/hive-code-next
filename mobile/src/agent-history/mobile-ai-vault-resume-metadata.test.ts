import { describe, expect, it, vi } from 'vitest'
import { loadMobileResumeMetadata } from './mobile-ai-vault-resume-metadata'
import type { RpcResponse } from '../transport/types'

function success(result: unknown): RpcResponse {
  return { id: 'metadata', ok: true, result }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('vault resume metadata operations', () => {
  it('starts all requests before awaiting and keeps optional transport failures optional', async () => {
    const client = {
      sendRequest: vi.fn(async (method: string) => {
        if (method === 'repo.list') {
          return success({ repos: [{ id: 'repo-1', executionHostId: 'local' }] })
        }
        if (method === 'settings.get') {
          return success({ settings: { agentDefaultArgs: { codex: '--safe' } } })
        }
        throw new Error('old host lacks optional metadata')
      })
    }
    const pending = loadMobileResumeMetadata(client)
    expect(client.sendRequest.mock.calls.map(([method]) => method)).toEqual([
      'repo.list',
      'folderWorkspace.list',
      'projectGroup.list',
      'settings.get',
      'worktree.ps'
    ])
    await expect(pending).resolves.toEqual({
      repos: [{ id: 'repo-1', executionHostId: 'local' }],
      folderWorkspaces: [],
      projectGroups: [],
      settings: { agentDefaultArgs: { codex: '--safe' } },
      worktrees: null
    })
  })

  it('rejects required transport failure immediately with its original identity', async () => {
    const failure = new Error('original transport failure')
    const client = {
      sendRequest: vi.fn((method: string) =>
        method === 'repo.list' ? Promise.reject(failure) : new Promise<RpcResponse>(() => {})
      )
    }
    await expect(loadMobileResumeMetadata(client)).rejects.toBe(failure)
  })

  it('waits for optional replies before interpreting a fulfilled required refusal', async () => {
    const optional = deferred<RpcResponse>()
    const client = {
      sendRequest: vi.fn(async (method: string) =>
        method === 'repo.list'
          ? { id: 'refused', ok: false as const, error: { code: 'denied', message: 'repo denied' } }
          : optional.promise
      )
    }
    let settled = false
    const pending = loadMobileResumeMetadata(client)
    void pending.then(
      () => {
        settled = true
      },
      () => {
        settled = true
      }
    )
    await Promise.resolve()
    await Promise.resolve()
    expect(settled).toBe(false)
    optional.resolve(success({}))
    await expect(pending).rejects.toThrow('repo denied')
  })

  it('rejects incompatible required rows and does not admit malformed optional metadata', async () => {
    const badRequired = {
      sendRequest: vi.fn(async (method: string) =>
        success(method === 'repo.list' ? { repos: [{ id: 7 }] } : {})
      )
    }
    await expect(loadMobileResumeMetadata(badRequired)).rejects.toThrow('incompatible_reply')
    const badOptional = {
      sendRequest: vi.fn(async (method: string) =>
        success(
          method === 'repo.list'
            ? { repos: [] }
            : { folderWorkspaces: 7, groups: 7, settings: { agentDefaultArgs: 7 }, worktrees: 7 }
        )
      )
    }
    await expect(loadMobileResumeMetadata(badOptional)).resolves.toEqual({
      repos: [],
      folderWorkspaces: [],
      projectGroups: [],
      settings: null,
      worktrees: null
    })
  })
})
