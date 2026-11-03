import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { operationModuleLoader } from '../operation-module-loader'
import { prSidebarMountAdapters } from './pr-sidebar-mount-adapters'
import type { RpcClient } from '../../../transport/rpc-client'
import type { RpcResponse } from '../../../transport/types'

const dto = {
  id: 'repo-9::/w',
  hostId: 'local',
  instanceId: 'i1',
  linkedPR: 7,
  suppressedGitHubPR: null,
  branch: 'feature',
  head: 'head',
  isBare: false,
  isArchived: false
}
const stale = {
  id: 'r',
  ok: true as const,
  result: {
    kind: 'found',
    pr: { number: 7, state: 'merged', headSha: 'old', headDivergedFromMergedPRAtOid: 'head' }
  }
}
function mount(sendRequest: RpcClient['sendRequest']) {
  const modules = operationModuleLoader(resolve(import.meta.dirname, '../../../../..'))
  return prSidebarMountAdapters(modules)['session.pr-sidebar']({
    client: { sendRequest } as RpcClient,
    effect: vi.fn()
  })
}

describe('recorded sidebar cleanup lifecycle', () => {
  it('never clears on a malformed containment proof despite a divergence marker', async () => {
    const sendRequest = vi.fn(async (method: string) => {
      if (method === 'worktree.show') {
        return { id: 'r', ok: true as const, result: { worktree: dto } }
      }
      if (method === 'github.prForBranch') {
        return {
          ...stale,
          result: { ...stale.result, pr: { ...stale.result.pr, confirmedContainedHeadOid: 42 } }
        }
      }
      return { id: 'r', ok: true as const, result: null }
    })
    const adapter = mount(sendRequest)
    await adapter.action('load', { headSha: 'head' })
    expect(sendRequest.mock.calls.some(([method]) => method === 'worktree.set')).toBe(false)
    await adapter.dispose()
  })
  it('carries real decoded divergence evidence through guarded clear and branch fallback', async () => {
    let prReads = 0
    const sendRequest = vi.fn(async (method: string) => {
      if (method === 'worktree.show') {
        return { id: 'r', ok: true as const, result: { worktree: dto } }
      }
      if (method === 'github.prForBranch' && ++prReads === 1) {
        return stale
      }
      return { id: 'r', ok: true as const, result: method === 'worktree.set' ? {} : null }
    })
    const adapter = mount(sendRequest)
    expect(await adapter.action('load', { headSha: 'head' })).toEqual({ kind: 'none' })
    expect(sendRequest).toHaveBeenCalledWith(
      'worktree.set',
      {
        worktree: 'id:repo-9::/w',
        linkedPR: null,
        githubLinkBase: { hostId: 'local', instanceId: 'i1', linkedPR: 7, suppressedGitHubPR: null }
      },
      { failWhenDisconnected: true }
    )
    expect(prReads).toBe(2)
    await adapter.dispose()
  })
  it.each(['dispose', 'supersede'] as const)(
    'retires a pending recorded payload on %s',
    async (mode) => {
      let finish!: (value: RpcResponse) => void
      let started!: () => void
      const requested = new Promise<void>((resolve) => {
        started = resolve
      })
      let prReads = 0
      const sendRequest = vi.fn(async (method: string): Promise<RpcResponse> => {
        if (method === 'worktree.show') {
          return { id: 'r', ok: true as const, result: { worktree: dto } }
        }
        if (method === 'github.prForBranch' && ++prReads === 1) {
          started()
          return new Promise((resolve) => {
            finish = resolve
          })
        }
        return { id: 'r', ok: true as const, result: null }
      })
      const adapter = mount(sendRequest)
      const pending = adapter.action('load', { headSha: 'head' })
      await requested
      if (mode === 'dispose') {
        await adapter.dispose()
      } else {
        await adapter.action('load', { headSha: 'head' })
      }
      finish(stale)
      await pending
      expect(sendRequest.mock.calls.some(([method]) => method === 'worktree.set')).toBe(false)
      expect(adapter.state()).toEqual(mode === 'dispose' ? 'unloaded' : { kind: 'none' })
      await adapter.dispose()
    }
  )
})
