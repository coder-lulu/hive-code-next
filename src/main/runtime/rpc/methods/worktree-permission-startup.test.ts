import { describe, expect, it, vi } from 'vitest'
import type { OrcaRuntimeService } from '../../orca-runtime'
import type { RpcRequest } from '../core'
import { RpcDispatcher } from '../dispatcher'
import { WORKTREE_METHODS } from './worktree'

const repo = {
  id: 'repo-1',
  path: '/workspace/repo',
  displayName: 'repo',
  badgeColor: '#000',
  addedAt: 1,
  kind: 'git' as const
}

function request(params: unknown): RpcRequest {
  return { id: 'req-1', authToken: 'token', method: 'worktree.create', params }
}

function createRuntime() {
  const createManagedWorktree = vi.fn().mockResolvedValue({ worktree: { id: 'wt-1' } })
  const runtime = {
    getRuntimeId: () => 'test-runtime',
    dedupeWorktreeCreate: <T>(_repo: string, _id: string | undefined, run: () => Promise<T>) =>
      run(),
    showRepo: vi.fn().mockResolvedValue(repo),
    createManagedWorktree
  } as unknown as OrcaRuntimeService
  return { runtime, createManagedWorktree }
}

describe('worktree permission startup RPC', () => {
  it('lets the Host resolve a token-bound semantic permission startup', async () => {
    const { runtime, createManagedWorktree } = createRuntime()
    const dispatcher = new RpcDispatcher({ runtime, methods: WORKTREE_METHODS })

    const response = await dispatcher.dispatch(
      request({
        repo: 'repo-1',
        name: 'semantic-startup',
        startupAgent: 'goose',
        startupCommand: 'goose',
        startupEnv: { GOOSE_MODE: 'auto' },
        startupLaunchToken: 'launch-token',
        startupPermissionMode: 'yolo',
        startupLaunchPreferences: { model: 'gpt-5.6-sol', effort: 'high' },
        startupPrompt: 'implement the task',
        activate: true
      })
    )

    expect(response.ok).toBe(true)
    expect(createManagedWorktree).toHaveBeenCalledWith(
      expect.objectContaining({
        repoSelector: 'repo-1',
        startup: undefined,
        startupAgent: 'goose',
        startupPermissionMode: 'yolo',
        startupLaunchPreferences: { model: 'gpt-5.6-sol', effort: 'high' },
        startupLaunchToken: 'launch-token',
        startupPrompt: 'implement the task'
      })
    )
  })

  it('rejects semantic permission startup for an unsupported agent', async () => {
    const { runtime, createManagedWorktree } = createRuntime()
    const dispatcher = new RpcDispatcher({ runtime, methods: WORKTREE_METHODS })

    const response = await dispatcher.dispatch(
      request({
        repo: 'repo-1',
        name: 'unsupported-startup',
        startupAgent: 'opencode',
        startupPermissionMode: 'manual'
      })
    )

    expect(response).toMatchObject({ ok: false, error: { code: 'invalid_argument' } })
    expect(createManagedWorktree).not.toHaveBeenCalled()
  })
})
