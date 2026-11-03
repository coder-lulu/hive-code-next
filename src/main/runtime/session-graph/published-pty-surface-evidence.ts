import { ORCA_LAYOUT_OWNER_IS_MAIN } from '../../../shared/layout-owner-switch'
import { ptyHoldsRecordedSurface } from '../pty-recorded-surface-topology'
import type { PtyPane } from '../terminal/surface/pty-pane-query'
import { parsePaneKey } from '../../../shared/stable-pane-id'
import type {
  RuntimeMobileSessionTabsSnapshot,
  RuntimeSyncedLeaf,
  RuntimeSyncedTab,
  RuntimeSyncWindowGraph
} from '../../../shared/runtime-types'
import type { RuntimePtyWorktreeRecord } from '../runtime-terminal-state-records'
import { terminalLayoutContainsLeaf } from '../../../shared/workspace-session-pane-ownership'
import { buildMaterializedHeadlessParentLayout } from '../mobile-session-layout-projection'

import type { PtySurfaceTopology } from '../pty-recorded-surface-topology'

export function collectRuntimeGraphSurfacePublications(
  graph: RuntimeSyncWindowGraph,
  previous: ReadonlyMap<string, RuntimeMobileSessionTabsSnapshot>,
  accepted: ReadonlyMap<string, { publicationEpoch: string }>,
  resyncWorktrees: ReadonlySet<string>,
  rendererGeneration: string | null | undefined
): Map<string, RuntimeMobileSessionTabsSnapshot> {
  const incoming = new Map(
    (graph.mobileSessionTabs ?? []).map((snapshot) => [snapshot.worktree, snapshot])
  )
  if (graph.mobileSessionTabs === undefined) {
    return incoming
  }
  for (const worktree of graph.unchangedMobileSessionWorktrees ?? []) {
    const prior = previous.get(worktree)
    if (
      prior &&
      !incoming.has(worktree) &&
      !resyncWorktrees.has(worktree) &&
      typeof rendererGeneration === 'string' &&
      accepted.get(worktree)?.publicationEpoch === rendererGeneration
    ) {
      incoming.set(worktree, prior)
    }
  }
  return incoming
}

export function collectRuntimeGraphSurfaceClaims(leaves: readonly RuntimeSyncedLeaf[]): {
  ptyIds: Set<string>
  ptyCounts: Map<string, number>
  paneCounts: Map<string, Map<string, number>>
} {
  const ptyIds = new Set<string>()
  const ptyCounts = new Map<string, number>()
  const paneCounts = new Map<string, Map<string, number>>()
  for (const leaf of leaves) {
    if (leaf.ptyId) {
      ptyIds.add(leaf.ptyId)
      ptyCounts.set(leaf.ptyId, (ptyCounts.get(leaf.ptyId) ?? 0) + 1)
    }
    const counts = paneCounts.get(leaf.tabId) ?? new Map<string, number>()
    counts.set(leaf.leafId, (counts.get(leaf.leafId) ?? 0) + 1)
    paneCounts.set(leaf.tabId, counts)
  }
  return { ptyIds, ptyCounts, paneCounts }
}

export function getPublishedRuntimeSurfacePtyId(
  leaf: RuntimeSyncedLeaf,
  previous: RuntimeMobileSessionTabsSnapshot | undefined
): string | null | undefined {
  if (previous?.worktree !== leaf.worktreeId) {
    return undefined
  }
  const surfaces = previous.tabs.filter(
    (tab) => tab.type === 'terminal' && tab.parentTabId === leaf.tabId && tab.leafId === leaf.leafId
  )
  const surface = surfaces.length === 1 ? surfaces[0] : undefined
  return surface?.type === 'terminal' ? surface.ptyId : undefined
}

/** Runtime publications also own surfaces that the desktop has never mounted. */
export function ptyHoldsPublishedRuntimeSurface(
  pty: Pick<
    RuntimePtyWorktreeRecord,
    | 'ptyId'
    | 'tabId'
    | 'paneKey'
    | 'worktreeId'
    | 'incarnationId'
    | 'connected'
    | 'runtimeSessionOwned'
  >,
  snapshot: RuntimeMobileSessionTabsSnapshot | undefined,
  topology: PtySurfaceTopology
): boolean {
  const pane = parsePaneKey(pty.paneKey ?? '')
  if (
    !pty.connected ||
    !pty.runtimeSessionOwned ||
    !pane ||
    pane.tabId !== pty.tabId ||
    snapshot?.worktree !== pty.worktreeId
  ) {
    return false
  }
  const graphPtyId = topology.ptyIdHoldingPane(pane.tabId, pane.leafId)
  if (graphPtyId !== undefined && graphPtyId !== pty.ptyId) {
    return false
  }
  return snapshot.tabs.some(
    (tab) =>
      tab.type === 'terminal' &&
      tab.parentTabId === pane.tabId &&
      tab.leafId === pane.leafId &&
      tab.ptyId === pty.ptyId &&
      (tab.incarnationId ?? null) === pty.incarnationId
  )
}

/** A live host publication can repair a missing projection, but cannot recreate a retired pane. */
function canRepairPublishedRuntimeSurface(
  pty: Parameters<typeof ptyHoldsPublishedRuntimeSurface>[0],
  leaf: RuntimeSyncedLeaf,
  previous: RuntimeMobileSessionTabsSnapshot | undefined,
  current: RuntimeMobileSessionTabsSnapshot | undefined
): boolean {
  const pane = parsePaneKey(pty.paneKey ?? '')
  if (
    !pty.incarnationId ||
    !previous ||
    leaf.ptyId !== null ||
    !pane ||
    leaf.worktreeId !== pty.worktreeId ||
    leaf.tabId !== pty.tabId ||
    leaf.tabId !== pane.tabId ||
    leaf.leafId !== pane.leafId ||
    current?.worktree !== pty.worktreeId ||
    previous?.worktreeInstanceId !== current.worktreeInstanceId ||
    !ptyHoldsPublishedRuntimeSurface(pty, previous, {
      graphSequence: 0,
      ptyIdHoldingPane: () => undefined
    })
  ) {
    return false
  }
  const priorOwners = previous.tabs.filter(
    (tab) => tab.type === 'terminal' && tab.ptyId === pty.ptyId
  )
  const currentSurfaces = current.tabs.filter(
    (tab) => tab.type === 'terminal' && tab.parentTabId === pane.tabId && tab.leafId === pane.leafId
  )
  const surface = currentSurfaces[0]
  return Boolean(
    priorOwners.length === 1 &&
    currentSurfaces.length === 1 &&
    surface?.type === 'terminal' &&
    surface.id === priorOwners[0]?.id &&
    (surface.ptyId == null || surface.ptyId === pty.ptyId) &&
    (surface.incarnationId == null || surface.incarnationId === pty.incarnationId) &&
    terminalLayoutContainsLeaf(surface.parentLayout?.root, pane.leafId) &&
    (!surface.parentLayout?.ptyIdsByLeafId?.[pane.leafId] ||
      surface.parentLayout.ptyIdsByLeafId[pane.leafId] === pty.ptyId) &&
    ![previous, current].some((snapshot) =>
      snapshot.tabs.some(
        (tab) =>
          tab.type === 'terminal' &&
          ((tab.ptyId === pty.ptyId &&
            (tab.parentTabId !== pane.tabId || tab.leafId !== pane.leafId)) ||
            Object.entries(tab.parentLayout?.ptyIdsByLeafId ?? {}).some(
              ([leafId, ptyId]) =>
                ptyId === pty.ptyId && (tab.parentTabId !== pane.tabId || leafId !== pane.leafId)
            ))
      )
    )
  )
}

export function repairPublishedRuntimeSurfaceProjection(
  pty: Parameters<typeof ptyHoldsPublishedRuntimeSurface>[0],
  leaf: RuntimeSyncedLeaf,
  previous: RuntimeMobileSessionTabsSnapshot | undefined,
  incoming: RuntimeMobileSessionTabsSnapshot | undefined,
  current: RuntimeMobileSessionTabsSnapshot | undefined
): RuntimeMobileSessionTabsSnapshot | undefined {
  if (
    !current ||
    !canRepairPublishedRuntimeSurface(pty, leaf, previous, incoming) ||
    !canRepairPublishedRuntimeSurface(pty, leaf, previous, current)
  ) {
    return undefined
  }
  const surface = current.tabs.find(
    (tab) => tab.type === 'terminal' && tab.parentTabId === leaf.tabId && tab.leafId === leaf.leafId
  )
  if (surface?.type !== 'terminal') {
    return undefined
  }
  if (
    surface.ptyId === pty.ptyId &&
    surface.incarnationId === pty.incarnationId &&
    surface.parentLayout?.ptyIdsByLeafId?.[leaf.leafId] === pty.ptyId
  ) {
    return current
  }
  const parentLayout = buildMaterializedHeadlessParentLayout(
    leaf.leafId,
    pty.ptyId,
    surface.parentLayout
  )
  return {
    ...current,
    snapshotVersion: current.snapshotVersion + 1,
    tabs: current.tabs.map((tab) =>
      tab.type === 'terminal' && tab.parentTabId === leaf.tabId
        ? {
            ...tab,
            parentLayout,
            ...(tab.leafId === leaf.leafId
              ? { ptyId: pty.ptyId, incarnationId: pty.incarnationId }
              : {})
          }
        : tab
    )
  }
}

/** The runtime indexes graph tabs by bare id, so duplicate ids cannot be routed safely. */
export function assertUniqueRuntimeGraphTabIds(tabs: readonly RuntimeSyncedTab[]): void {
  const seen = new Set<string>()
  for (const tab of tabs) {
    if (seen.has(tab.tabId)) {
      throw new Error('duplicate_runtime_tab_id')
    }
    seen.add(tab.tabId)
  }
}

export function isPtySurfaceOrphaned(
  pty: RuntimePtyWorktreeRecord,
  recorded: PtyPane,
  snapshot: RuntimeMobileSessionTabsSnapshot | undefined,
  topology: PtySurfaceTopology
): boolean {
  return (
    !ptyHoldsRecordedSurface(pty.ptyId, recorded, topology) &&
    (ORCA_LAYOUT_OWNER_IS_MAIN || !ptyHoldsPublishedRuntimeSurface(pty, snapshot, topology))
  )
}
