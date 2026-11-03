import { describe, expect, it, vi } from 'vitest'
import { fetchWorktreeGitHubLinkBase, unlinkMobilePr } from './mobile-pr-link'

const worktree = {
  hostId: 'local' as const,
  instanceId: 'instance-1',
  linkedPR: 42,
  suppressedGitHubPR: 8
}

describe('mobile GitHub unlink compare-and-set', () => {
  it('suppresses the displayed auto-discovered PR while retaining the stored null link in CAS', async () => {
    const sendRequest = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        result: { worktree: { id: 'w', ...worktree, linkedPR: null } }
      })
      .mockResolvedValueOnce({ ok: true, result: {} })
    const client = { sendRequest }
    const base = await fetchWorktreeGitHubLinkBase(client, 'w')
    expect(await unlinkMobilePr(client, 'w', 7, base)).toEqual({ ok: true })
    expect(sendRequest).toHaveBeenNthCalledWith(2, 'worktree.set', {
      worktree: 'id:w',
      linkedPR: null,
      suppressedGitHubPR: 7,
      githubLinkBase: { ...worktree, linkedPR: null }
    })
  })

  it.each([0, -1, 1.5, Number.NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid displayed PR number %s without writing',
    async (prNumber) => {
      const sendRequest = vi.fn()
      expect(await unlinkMobilePr({ sendRequest }, 'w', prNumber, worktree)).toMatchObject({
        ok: false
      })
      expect(sendRequest).not.toHaveBeenCalled()
    }
  )
  it('captures persisted metadata and sends exactly that snapshot once', async () => {
    const sendRequest = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, result: { worktree: { id: 'w', ...worktree } } })
      .mockResolvedValueOnce({ ok: true, result: {} })
    const client = { sendRequest }
    const base = await fetchWorktreeGitHubLinkBase(client, 'w')
    expect(base).toEqual(worktree)
    expect(await unlinkMobilePr(client, 'w', 7, base)).toEqual({ ok: true })
    expect(sendRequest).toHaveBeenNthCalledWith(2, 'worktree.set', {
      worktree: 'id:w',
      linkedPR: null,
      suppressedGitHubPR: 7,
      githubLinkBase: worktree
    })
    expect(sendRequest).toHaveBeenCalledTimes(2)
  })

  it.each([
    { linkedPR: 42 },
    { hostId: 'local' },
    { ...worktree, identity: { executionHostId: 'ssh:other' } },
    { ...worktree, linkedPR: '42' },
    { ...worktree, suppressedGitHubPR: -1 },
    { ...worktree, instanceId: '' }
  ])('refuses incomplete or conflicting ownership without a write: %j', async (value) => {
    const sendRequest = vi
      .fn()
      .mockResolvedValue({ ok: true, result: { worktree: { id: 'w', ...value } } })
    const client = { sendRequest }
    const base = await fetchWorktreeGitHubLinkBase(client, 'w')
    expect(base).toBeNull()
    expect(await unlinkMobilePr(client, 'w', 7, base)).toMatchObject({ ok: false })
    expect(sendRequest).toHaveBeenCalledTimes(1)
  })

  it('keeps an unlinked stored value null when a branch PR is displayed', async () => {
    const sendRequest = vi.fn().mockResolvedValue({
      ok: true,
      result: { worktree: { id: 'w', hostId: 'local', linkedPR: null } }
    })
    expect(await fetchWorktreeGitHubLinkBase({ sendRequest }, 'w')).toEqual({
      hostId: 'local',
      instanceId: null,
      linkedPR: null,
      suppressedGitHubPR: null
    })
  })

  it('surfaces a stale snapshot refusal without rereading or retrying', async () => {
    const sendRequest = vi.fn().mockResolvedValue({
      ok: false,
      error: { code: 'conflict', message: 'GitHub link snapshot changed' }
    })
    expect(await unlinkMobilePr({ sendRequest }, 'w', 7, worktree)).toEqual({
      ok: false,
      error: 'GitHub link snapshot changed'
    })
    expect(sendRequest).toHaveBeenCalledOnce()
  })

  it.each([undefined, null, '', 'other-worktree', 42])(
    'rejects absent or mismatched response id %j before writing',
    async (id) => {
      const returned = id === undefined ? { ...worktree } : { ...worktree, id }
      const sendRequest = vi.fn().mockResolvedValue({ ok: true, result: { worktree: returned } })
      const client = { sendRequest }
      const base = await fetchWorktreeGitHubLinkBase(client, 'w')
      expect(base).toBeNull()
      expect(await unlinkMobilePr(client, 'w', 7, base)).toMatchObject({ ok: false })
      expect(sendRequest).toHaveBeenCalledOnce()
    }
  )

  it('does not retry a transport failure with an uncertain delivery', async () => {
    const sendRequest = vi.fn().mockRejectedValue(new Error('connection lost'))
    expect(await unlinkMobilePr({ sendRequest }, 'w', 7, worktree)).toEqual({
      ok: false,
      error: 'connection lost'
    })
    expect(sendRequest).toHaveBeenCalledOnce()
  })
})
