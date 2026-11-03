// @vitest-environment happy-dom
import { renderHook, act } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useUnlinkGitHubPullRequest } from './use-unlink-github-pull-request'
import type { Worktree } from '../../../../../shared/worktree/types'
import type { HostedReviewInfo } from '../../../../../shared/hosted-review'

const mocks = vi.hoisted(() => ({ error: vi.fn() }))
vi.mock('sonner', () => ({ toast: { error: mocks.error } }))
beforeEach(() => vi.clearAllMocks())
describe('GitHub unlink displayed snapshot', () => {
  it('suppresses the displayed automatic review while retaining a null explicit link in the base', async () => {
    const updateWorktreeMeta = vi.fn().mockResolvedValue({ ok: true })
    const activeWorktree: Worktree = {
      id: 'wt',
      repoId: 'repo',
      path: '/feature',
      branch: 'refs/heads/feature',
      head: 'head',
      displayName: 'Feature',
      comment: '',
      linkedIssue: null,
      linkedLinearIssue: null,
      isArchived: false,
      isUnread: false,
      isPinned: false,
      sortOrder: 0,
      lastActivityAt: 0,
      isBare: false,
      isMainWorktree: false,
      hostId: 'ssh:owner',
      instanceId: 'instance-1',
      linkedPR: null,
      suppressedGitHubPR: 41
    }
    const { result } = renderHook(() =>
      useUnlinkGitHubPullRequest({
        activeWorktree,
        activeWorktreeId: 'wt',
        linkedPR: null,
        activeReview: { provider: 'github', number: 72 } as HostedReviewInfo,
        updateWorktreeMeta
      })
    )
    await act(() => result.current())
    expect(updateWorktreeMeta).toHaveBeenCalledWith(
      'wt',
      { linkedPR: null, suppressedGitHubPR: 72 },
      {
        executionHostId: 'ssh:owner',
        githubLinkBase: {
          hostId: 'ssh:owner',
          instanceId: 'instance-1',
          linkedPR: null,
          suppressedGitHubPR: 41
        }
      }
    )
  })
  it('reports a refused write without retrying', async () => {
    const updateWorktreeMeta = vi
      .fn()
      .mockResolvedValue({ ok: false, error: 'github_link_conflict' })
    const { result } = renderHook(() =>
      useUnlinkGitHubPullRequest({
        activeWorktree: { id: 'wt', hostId: 'local', linkedPR: 72 } as Worktree,
        activeWorktreeId: 'wt',
        linkedPR: 72,
        activeReview: { provider: 'github', number: 72 } as HostedReviewInfo,
        updateWorktreeMeta
      })
    )
    await act(() => result.current())
    expect(updateWorktreeMeta).toHaveBeenCalledTimes(1)
    expect(mocks.error).toHaveBeenCalledWith('github_link_conflict')
  })
})
