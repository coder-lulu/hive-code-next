import { describe, expect, it, vi } from 'vitest'
import type { PRInfo } from '../../../src/shared/github/pull-request-types'
import { loadPrSidebarData, type PrSidebarLoadDeps } from './mobile-pr-sidebar-state'
import type { WorktreeGitHubPRLink } from '../source-control/mobile-pr-link'
import { resolveMobileSourceControlReviewInputs } from '../source-control/mobile-source-control-primary-action'

const pr: PRInfo = {
  number: 7,
  title: 'PR',
  state: 'merged',
  url: 'u',
  checksStatus: 'success',
  updatedAt: 'now',
  mergeable: 'MERGEABLE',
  headSha: 'old',
  headDivergedFromMergedPRAtOid: 'head'
}
const link: WorktreeGitHubPRLink = {
  worktreeId: 'w',
  githubLinkBase: { hostId: 'local', instanceId: 'i1', linkedPR: 7, suppressedGitHubPR: null },
  summary: {
    branch: 'feature',
    head: 'head',
    isBare: false,
    isArchived: false,
    pushTargetBranch: null
  }
}
const args = { worktreeId: 'w', branch: 'feature', headSha: 'head', isCurrent: () => true }
function deps(first = pr, snapshot = link) {
  return {
    fetchForBranch: vi.fn(async () => ({ ok: true as const, result: null })),
    fetchWorktreeGitHubPRLink: vi.fn(async () => snapshot),
    clearWorktreeReviewLink: vi.fn(async () => ({ ok: true as const })),
    fetchPRForBranch: vi
      .fn()
      .mockResolvedValueOnce({ ok: true, result: first })
      .mockResolvedValue({ ok: true, result: null }),
    fetchWorkItemDetails: vi.fn(async () => ({ ok: true as const, result: null })),
    fetchPRChecks: vi.fn(async () => ({ ok: true as const, result: [] }))
  } satisfies PrSidebarLoadDeps
}

describe('sidebar stale-link lifecycle', () => {
  it.each(['merged', 'open', 'draft'] as const)(
    'clears a proven stale %s link before branch refetch',
    async (state) => {
      const d = deps({ ...pr, state, headRefName: 'old-feature' })
      expect(await loadPrSidebarData(d, args)).toEqual({ kind: 'none' })
      expect(d.clearWorktreeReviewLink).toHaveBeenCalledWith('w', link, expect.any(Function))
      expect(d.fetchPRForBranch).toHaveBeenNthCalledWith(2, 'w', {
        branch: 'feature',
        linkedPRNumber: null,
        fallbackPRNumber: null,
        currentHeadOid: 'head'
      })
    }
  )
  it.each([
    { headDivergedFromMergedPRAtOid: undefined },
    { confirmedContainedHeadOid: 'head' },
    { headSha: 'head' },
    { number: 8 },
    { state: 'closed' as const }
  ])('retains a link without positive stale evidence %j', async (change) => {
    const d = deps({ ...pr, ...change })
    expect((await loadPrSidebarData(d, args)).kind).toBe('ready')
    expect(d.clearWorktreeReviewLink).not.toHaveBeenCalled()
  })
  it('retains an open review whose push target is its PR branch', async () => {
    const pushTarget = { remoteName: 'fork', branchName: 'old-feature' }
    const d = deps(
      { ...pr, state: 'open', headRefName: 'old-feature' },
      { ...link, summary: { ...link.summary!, pushTargetBranch: 'old-feature', pushTarget } }
    )
    const state = await loadPrSidebarData(d, args)
    expect(d.clearWorktreeReviewLink).not.toHaveBeenCalled()
    expect(resolveMobileSourceControlReviewInputs(state).pushTarget).toEqual(pushTarget)
  })
  it('contains a stale CAS refusal without branch fallback or optimistic success', async () => {
    const d: PrSidebarLoadDeps = {
      ...deps(),
      clearWorktreeReviewLink: vi.fn(async () => ({ ok: false, error: 'stale link' }))
    }
    expect(await loadPrSidebarData(d, args)).toEqual({ kind: 'error', message: 'stale link' })
    expect(d.fetchPRForBranch).toHaveBeenCalledTimes(1)
  })
  it('keeps suppression effective for an auto-discovered PR after refresh', async () => {
    const d = deps(pr, {
      ...link,
      githubLinkBase: { ...link.githubLinkBase, linkedPR: null, suppressedGitHubPR: 7 }
    })
    expect(await loadPrSidebarData(d, args)).toEqual({ kind: 'none' })
    expect(d.clearWorktreeReviewLink).not.toHaveBeenCalled()
  })
  it('never starts cleanup after the load owner is cancelled', async () => {
    let current = true
    const d = deps()
    d.fetchPRForBranch.mockReset().mockImplementationOnce(async () => {
      current = false
      return { ok: true, result: pr }
    })
    expect(await loadPrSidebarData(d, { ...args, isCurrent: () => current })).toEqual({
      kind: 'hidden'
    })
    expect(d.clearWorktreeReviewLink).not.toHaveBeenCalled()
  })
  it('uses the post-clear base for an independently found PR', async () => {
    const d = deps()
    d.fetchPRForBranch
      .mockReset()
      .mockResolvedValueOnce({ ok: true, result: pr })
      .mockResolvedValueOnce({ ok: true, result: { ...pr, number: 8, state: 'open' } })
    expect(await loadPrSidebarData(d, args)).toMatchObject({
      kind: 'ready',
      data: { githubLinkBase: { linkedPR: null }, pr: { number: 8 } }
    })
  })
})
