import { parsePaneKey } from '../../shared/stable-pane-id'
import type {
  RuntimeMobileSessionTabsSnapshot,
  RuntimeSyncedLeaf
} from '../../shared/runtime-types'
import type { RuntimePtyWorktreeRecord } from './runtime-terminal-state-records'
import { terminalLayoutContainsLeaf } from './headless-terminal-split-layout'

type NativeSurface = Pick<
  RuntimePtyWorktreeRecord,
  | 'ptyId'
  | 'incarnationId'
  | 'tabId'
  | 'paneKey'
  | 'worktreeId'
  | 'connected'
  | 'runtimeSessionOwned'
>

function hasCompetingPtyClaim(
  snapshot: RuntimeMobileSessionTabsSnapshot,
  leaf: RuntimeSyncedLeaf,
  pty: NativeSurface
): boolean {
  return snapshot.tabs.some(
    (tab) =>
      tab.type === 'terminal' &&
      ((tab.ptyId === pty.ptyId &&
        (tab.parentTabId !== leaf.tabId || tab.leafId !== leaf.leafId)) ||
        Object.entries(tab.parentLayout?.ptyIdsByLeafId ?? {}).some(
          ([leafId, ptyId]) =>
            ptyId === pty.ptyId && (tab.parentTabId !== leaf.tabId || leafId !== leaf.leafId)
        ))
  )
}

function ownsBoundSurface(
  snapshot: RuntimeMobileSessionTabsSnapshot,
  leaf: RuntimeSyncedLeaf,
  pty: NativeSurface
): boolean {
  const owners = snapshot.tabs.filter((tab) => tab.type === 'terminal' && tab.ptyId === pty.ptyId)
  const surfaces = snapshot.tabs.filter(
    (tab) => tab.type === 'terminal' && tab.parentTabId === leaf.tabId && tab.leafId === leaf.leafId
  )
  const surface = surfaces[0]
  return Boolean(
    snapshot.worktree === pty.worktreeId &&
    owners.length === 1 &&
    surfaces.length === 1 &&
    surface?.type === 'terminal' &&
    surface.ptyId === pty.ptyId &&
    (surface.incarnationId == null || surface.incarnationId === pty.incarnationId) &&
    terminalLayoutContainsLeaf(surface.parentLayout?.root, leaf.leafId) &&
    surface.parentLayout?.ptyIdsByLeafId?.[leaf.leafId] === pty.ptyId &&
    !hasCompetingPtyClaim(snapshot, leaf, pty)
  )
}

/** Certify an explicit native binding before an incomplete renderer publication can erase it. */
export function certifyBoundRuntimeSurfaceIncarnation(
  pty: NativeSurface,
  leaf: RuntimeSyncedLeaf,
  previous: RuntimeMobileSessionTabsSnapshot | undefined,
  incoming: RuntimeMobileSessionTabsSnapshot,
  current: RuntimeMobileSessionTabsSnapshot
): RuntimeMobileSessionTabsSnapshot | undefined {
  const pane = parsePaneKey(pty.paneKey ?? '')
  const original = previous?.tabs.filter(
    (tab) => tab.type === 'terminal' && tab.parentTabId === leaf.tabId && tab.leafId === leaf.leafId
  )
  const incomingSurface = incoming.tabs.find(
    (tab) => tab.type === 'terminal' && tab.parentTabId === leaf.tabId && tab.leafId === leaf.leafId
  )
  const currentSurface = current.tabs.find(
    (tab) => tab.type === 'terminal' && tab.parentTabId === leaf.tabId && tab.leafId === leaf.leafId
  )
  if (
    !pty.connected ||
    !pty.runtimeSessionOwned ||
    !pty.incarnationId ||
    !pane ||
    leaf.ptyId !== pty.ptyId ||
    leaf.worktreeId !== pty.worktreeId ||
    leaf.tabId !== pty.tabId ||
    leaf.tabId !== pane.tabId ||
    leaf.leafId !== pane.leafId ||
    incoming.worktreeInstanceId !== current.worktreeInstanceId ||
    incomingSurface?.id !== currentSurface?.id ||
    !ownsBoundSurface(incoming, leaf, pty) ||
    !ownsBoundSurface(current, leaf, pty) ||
    (previous &&
      (previous.worktreeInstanceId !== current.worktreeInstanceId ||
        original?.length !== 1 ||
        original[0]?.id !== currentSurface?.id ||
        hasCompetingPtyClaim(previous, leaf, pty) ||
        (original[0]?.type === 'terminal' &&
          ((original[0].ptyId != null && original[0].ptyId !== pty.ptyId) ||
            (original[0].incarnationId != null &&
              original[0].incarnationId !== pty.incarnationId)))))
  ) {
    return undefined
  }
  if (currentSurface?.type !== 'terminal' || currentSurface.incarnationId === pty.incarnationId) {
    return undefined
  }
  return {
    ...current,
    snapshotVersion: current.snapshotVersion + 1,
    tabs: current.tabs.map((tab) =>
      tab === currentSurface ? { ...tab, incarnationId: pty.incarnationId } : tab
    )
  }
}
