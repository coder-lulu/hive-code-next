import type { RuntimeClientTarget } from '../../../../../../shared/runtime-client-target'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createUpdateWorktreeGitIdentity } from './worktree-git-identity-update'
import type { WorktreeSliceGet, WorktreeSliceSet } from '../listing/worktree-slice-types'
import type { Worktree } from '../../../../../../shared/worktree/types'

const mocks = vi.hoisted(() => ({
  persist: vi.fn(),
  fetch: vi.fn(),
  owner: vi.fn<() => RuntimeClientTarget | null>()
}))
vi.mock('./worktree-meta-persist', () => ({ persistWorktreeMeta: mocks.persist }))
vi.mock('../../worktree-helpers', () => ({
  getRepoIdFromWorktreeId: () => 'repo',
  applyWorktreeUpdates: vi.fn()
}))
vi.mock('../listing/detected-worktree-meta', () => ({ applyDetectedWorktreeUpdates: vi.fn() }))
vi.mock('../listing/worktree-owner-target', () => ({
  runtimeTargetForWorktreeOwner: () => ({ kind: 'local' })
}))
vi.mock('@/lib/resolve-owner', () => ({
  runtimeTargetForWorkspaceOwner: mocks.owner
}))
vi.mock('@/lib/git-utils', () => ({
  branchName: (value: string) => value.replace('refs/heads/', '')
}))

function harness(overrides: Partial<Worktree> = {}) {
  let state = {
    repos: [{ id: 'repo', path: '/repo', displayName: 'Repo', badgeColor: '', addedAt: 0 }],
    worktreesByRepo: {
      repo: [
        {
          id: 'repo::/feature',
          repoId: 'repo',
          path: '/feature',
          hostId: 'local',
          instanceId: 'generation-1',
          head: 'old',
          branch: 'refs/heads/old',
          linkedPR: 42,
          suppressedGitHubPR: 7,
          displayName: 'old',
          ...overrides
        } as Worktree
      ]
    },
    sortEpoch: 0,
    getKnownWorktreeById: () => state.worktreesByRepo.repo[0],
    fetchWorktrees: mocks.fetch
  }
  const get = (() => state) as unknown as WorktreeSliceGet
  const set = ((update: (state: unknown) => object) => {
    state = { ...state, ...update(state) }
  }) as WorktreeSliceSet
  return { get, update: createUpdateWorktreeGitIdentity(set, get) }
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.persist.mockResolvedValue(undefined)
  mocks.owner.mockReturnValue({ kind: 'local' })
})
describe('branch change GitHub link base', () => {
  it('refuses a durable clear when the observed row has no host identity', async () => {
    const { update } = harness({ hostId: undefined })
    update('repo::/feature', { branch: 'refs/heads/new' }, null)
    await Promise.resolve()
    expect(mocks.persist).not.toHaveBeenCalled()
  })
  it('refuses a queued write after the owner becomes unavailable', async () => {
    const { update } = harness()
    update('repo::/feature', { branch: 'refs/heads/new' }, 'local')
    mocks.owner.mockReturnValue(null)
    await Promise.resolve()
    expect(mocks.persist).not.toHaveBeenCalled()
  })

  it('writes the pre-clear snapshot exactly once', async () => {
    const { get, update } = harness()
    update('repo::/feature', { branch: 'refs/heads/new', head: 'new' }, 'local')
    expect(get().worktreesByRepo.repo[0].linkedPR).toBeNull()
    await vi.waitFor(() => expect(mocks.persist).toHaveBeenCalledTimes(1))
    expect(mocks.persist.mock.lastCall?.[5]).toEqual({
      hostId: 'local',
      instanceId: 'generation-1',
      linkedPR: 42,
      suppressedGitHubPR: 7
    })
  })
  it('refetches a conflict without reissuing a clear', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.persist.mockRejectedValueOnce(new Error('github_link_conflict'))
    const { update } = harness()
    update('repo::/feature', { branch: 'refs/heads/new', head: 'new' }, 'local')
    await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledWith('repo'))
    expect(mocks.persist).toHaveBeenCalledTimes(1)
    error.mockRestore()
  })
})
