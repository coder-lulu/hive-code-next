import type { BrowserWindow } from 'electron'
import type { RuntimeMobileSessionTabsSnapshot } from '../../shared/runtime-types'
import { waitForTabRegistration } from '../ipc/browser-tab-registration-wait'

const pendingByWindow = new WeakMap<BrowserWindow, Map<string, Promise<void>>>()
const RESTORE_CONCURRENCY = 4

/** Restore only a requested renderer-owned workspace; listing the fleet must stay lazy. */
export function restoreRendererBrowserSessionTabs(args: {
  window: BrowserWindow | null
  snapshot: RuntimeMobileSessionTabsSnapshot | undefined
  getLivePageIds: () => ReadonlySet<string>
  waitForRegistration?: (pageId: string) => Promise<void>
}): Promise<void> {
  const { window, snapshot } = args
  if (!window || window.isDestroyed() || !snapshot?.publicationEpoch.startsWith('renderer:')) {
    return Promise.resolve()
  }
  let pending = pendingByWindow.get(window)
  if (!pending) {
    pending = new Map()
    pendingByWindow.set(window, pending)
  }
  const existing = pending.get(snapshot.worktree)
  if (existing) {
    return existing
  }
  const live = args.getLivePageIds()
  const pages = [
    ...new Set(
      snapshot.tabs.flatMap((tab) =>
        tab.type === 'browser' && tab.browserPageId && !live.has(tab.browserPageId)
          ? [tab.browserPageId]
          : []
      )
    )
  ]
  if (pages.length === 0) {
    return Promise.resolve()
  }
  const restore = (async () => {
    for (let offset = 0; offset < pages.length; offset += RESTORE_CONCURRENCY) {
      if (window.isDestroyed() || window.webContents.isDestroyed()) {
        throw new Error('browser_restore_window_unavailable')
      }
      const results = await Promise.allSettled(
        pages.slice(offset, offset + RESTORE_CONCURRENCY).map(async (browserPageId) => {
          if (args.getLivePageIds().has(browserPageId)) {
            return
          }
          window.webContents.send('browser:activateView', {
            worktreeId: snapshot.worktree,
            browserPageId
          })
          await (args.waitForRegistration ?? waitForTabRegistration)(browserPageId)
        })
      )
      const failure = results.find((result) => result.status === 'rejected')
      if (failure?.status === 'rejected') {
        throw failure.reason
      }
    }
  })().finally(() => pending.delete(snapshot.worktree))
  pending.set(snapshot.worktree, restore)
  return restore
}
