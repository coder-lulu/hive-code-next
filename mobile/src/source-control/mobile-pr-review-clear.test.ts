import { describe, expect, it, vi } from 'vitest'
import {
  clearMobileWorktreeReviewLink,
  fetchWorktreeGitHubPRLink,
  type WorktreeGitHubPRLink
} from './mobile-pr-link'

const dto = {
  id: 'w',
  hostId: 'ssh:server',
  instanceId: 'i1',
  linkedPR: 7,
  suppressedGitHubPR: 4,
  branch: 'feature',
  head: 'new-head',
  isBare: false,
  isArchived: false
}
const expected: WorktreeGitHubPRLink = {
  worktreeId: 'w',
  githubLinkBase: { hostId: 'ssh:server', instanceId: 'i1', linkedPR: 7, suppressedGitHubPR: 4 },
  summary: {
    branch: 'feature',
    head: 'new-head',
    isBare: false,
    isArchived: false,
    pushTargetBranch: null
  }
}
const response = (worktree: unknown) => ({ id: 'r', ok: true as const, result: { worktree } })

describe('durable mobile review cleanup', () => {
  it('refuses a snapshot captured for another target without reading', async () => {
    const sendRequest = vi.fn()
    expect(
      await clearMobileWorktreeReviewLink({ sendRequest }, 'other', expected, () => true)
    ).toMatchObject({ ok: false })
    expect(sendRequest).not.toHaveBeenCalled()
  })
  it('does not retry a transport failure after dispatch', async () => {
    const sendRequest = vi
      .fn()
      .mockResolvedValueOnce(response(dto))
      .mockRejectedValueOnce(new Error('delivery unknown'))
    expect(
      await clearMobileWorktreeReviewLink({ sendRequest }, 'w', expected, () => true)
    ).toMatchObject({ ok: false })
    expect(sendRequest).toHaveBeenCalledTimes(2)
  })
  it('reads ownership and clears only its stored GitHub link with the same CAS once', async () => {
    const sendRequest = vi
      .fn()
      .mockResolvedValueOnce(response(dto))
      .mockResolvedValueOnce(response(dto))
      .mockResolvedValueOnce({ id: 'r', ok: true, result: {} })
    const client = { sendRequest }
    const link = await fetchWorktreeGitHubPRLink(client, 'w')
    expect(link).toEqual(expected)
    expect(await clearMobileWorktreeReviewLink(client, 'w', expected, () => true)).toEqual({
      ok: true
    })
    expect(sendRequest).toHaveBeenLastCalledWith(
      'worktree.set',
      { worktree: 'id:w', linkedPR: null, githubLinkBase: expected.githubLinkBase },
      { failWhenDisconnected: true }
    )
    expect(sendRequest).toHaveBeenCalledTimes(3)
  })
  it.each([
    { id: undefined },
    { id: 'other' },
    { hostId: undefined },
    { hostId: 'ssh:other' },
    { instanceId: 'new' },
    { linkedPR: 8 },
    { suppressedGitHubPR: 9 },
    { branch: 'other' },
    { head: 'newer' },
    { isBare: true },
    { isArchived: true },
    { pushTarget: { branchName: 'new-target' } },
    { isBare: undefined }
  ])('refuses changed or unknown target metadata %j', async (change) => {
    const sendRequest = vi.fn().mockResolvedValue(response({ ...dto, ...change }))
    expect(
      await clearMobileWorktreeReviewLink({ sendRequest }, 'w', expected, () => true)
    ).toMatchObject({ ok: false })
    expect(sendRequest).toHaveBeenCalledTimes(1)
  })
  it('refuses ownership loss while the fresh read is pending', async () => {
    let current = true
    const sendRequest = vi.fn(async () => {
      current = false
      return response(dto)
    })
    expect(
      await clearMobileWorktreeReviewLink({ sendRequest }, 'w', expected, () => current)
    ).toMatchObject({ ok: false })
    expect(sendRequest).toHaveBeenCalledTimes(1)
  })
  it('does not report success after cancellation of a dispatched write', async () => {
    let current = true
    const sendRequest = vi
      .fn()
      .mockResolvedValueOnce(response(dto))
      .mockImplementationOnce(async () => {
        current = false
        return { id: 'r', ok: true, result: {} }
      })
    expect(
      await clearMobileWorktreeReviewLink({ sendRequest }, 'w', expected, () => current)
    ).toMatchObject({ ok: false })
    expect(sendRequest).toHaveBeenCalledTimes(2)
  })
  it.each([
    { id: 'r', ok: false, error: { message: 'stale github link' } },
    { id: 'r', ok: true }
  ])('never retries an unaccepted write %j', async (reply) => {
    const sendRequest = vi.fn().mockResolvedValueOnce(response(dto)).mockResolvedValueOnce(reply)
    expect(
      await clearMobileWorktreeReviewLink({ sendRequest }, 'w', expected, () => true)
    ).toMatchObject({ ok: false })
    expect(sendRequest).toHaveBeenCalledTimes(2)
  })
  it('refuses an already cancelled owner without reading', async () => {
    const sendRequest = vi.fn()
    expect(
      await clearMobileWorktreeReviewLink({ sendRequest }, 'w', expected, () => false)
    ).toMatchObject({ ok: false })
    expect(sendRequest).not.toHaveBeenCalled()
  })
})
