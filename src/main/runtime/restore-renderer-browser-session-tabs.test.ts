import { describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import type { RuntimeMobileSessionTabsSnapshot } from '../../shared/runtime-types'

vi.mock('../ipc/browser-tab-registration-wait', () => ({ waitForTabRegistration: vi.fn() }))
import { restoreRendererBrowserSessionTabs } from './restore-renderer-browser-session-tabs'

function setup(pageIds = ['page-1'], worktree = 'folder:folder-1') {
  const send = vi.fn()
  const window = {
    isDestroyed: () => false,
    webContents: { isDestroyed: () => false, send }
  } as unknown as BrowserWindow
  const snapshot = {
    worktree,
    publicationEpoch: 'renderer:boot-2',
    snapshotVersion: 1,
    activeGroupId: null,
    activeTabId: null,
    activeTabType: null,
    tabs: pageIds.map((id) => ({ type: 'browser', id, browserPageId: id }))
  } as RuntimeMobileSessionTabsSnapshot
  const live = new Set<string>()
  const args = {
    window,
    snapshot,
    getLivePageIds: () => live,
    waitForRegistration: vi.fn(async (id: string) => {
      live.add(id)
    })
  }
  return { args, send, live }
}

describe('requested browser workspace restoration', () => {
  it.each(['folder:folder-1', 'repo::/worktree'])(
    'registers restored pages without selecting the host pane: %s',
    async (worktree) => {
      const { args, send, live } = setup(['page-1', 'page-2'], worktree)
      live.add('page-1')
      await restoreRendererBrowserSessionTabs(args)
      expect(send.mock.calls).toEqual([
        ['browser:activateView', { worktreeId: worktree, browserPageId: 'page-2' }]
      ])
      expect(args.waitForRegistration).toHaveBeenCalledWith('page-2')
      await restoreRendererBrowserSessionTabs(args)
      expect(send).toHaveBeenCalledTimes(1)
    }
  )

  it('merges simultaneous polls and caps concurrent page mounts', async () => {
    const { args, send, live } = setup(['1', '2', '3', '4', '5'])
    const releases: (() => void)[] = []
    args.waitForRegistration.mockImplementation(
      (id) =>
        new Promise<void>((resolve) => {
          releases.push(() => {
            live.add(id)
            resolve()
          })
        })
    )
    const first = restoreRendererBrowserSessionTabs(args)
    expect(restoreRendererBrowserSessionTabs(args)).toBe(first)
    expect(send).toHaveBeenCalledTimes(4)
    releases.splice(0).forEach((release) => release())
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(5))
    releases.splice(0).forEach((release) => release())
    await first
  })

  it('reports failed registration and allows a later retry', async () => {
    const { args, send } = setup()
    args.waitForRegistration.mockRejectedValueOnce(new Error('registration timeout'))
    await expect(restoreRendererBrowserSessionTabs(args)).rejects.toThrow('registration timeout')
    await restoreRendererBrowserSessionTabs(args)
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('retains the shared attempt until the entire failing batch settles', async () => {
    const { args, send } = setup(['1', '2'])
    let finish!: () => void
    args.waitForRegistration.mockImplementation((id) =>
      id === '1'
        ? Promise.reject(new Error('registration timeout'))
        : new Promise<void>((resolve) => {
            finish = resolve
          })
    )
    const first = restoreRendererBrowserSessionTabs(args)
    const rejected = expect(first).rejects.toThrow('registration timeout')
    await Promise.resolve()
    expect(restoreRendererBrowserSessionTabs(args)).toBe(first)
    expect(send).toHaveBeenCalledTimes(2)
    finish()
    await rejected
  })

  it('does not create pages for a headless or absent renderer snapshot', async () => {
    const { args, send } = setup()
    await restoreRendererBrowserSessionTabs({ ...args, window: null })
    await restoreRendererBrowserSessionTabs({ ...args, snapshot: undefined })
    await restoreRendererBrowserSessionTabs({
      ...args,
      snapshot: { ...args.snapshot, publicationEpoch: 'headless:1' }
    })
    expect(send).not.toHaveBeenCalled()
  })

  it('keeps workspaces and replacement windows isolated', async () => {
    const first = setup(['page-1'], 'folder:a')
    const next = setup(['page-1'], 'folder:b')
    await Promise.all([
      restoreRendererBrowserSessionTabs(first.args),
      restoreRendererBrowserSessionTabs(next.args)
    ])
    expect(first.send).toHaveBeenCalledWith('browser:activateView', {
      worktreeId: 'folder:a',
      browserPageId: 'page-1'
    })
    expect(next.send).toHaveBeenCalledWith('browser:activateView', {
      worktreeId: 'folder:b',
      browserPageId: 'page-1'
    })
  })
})
