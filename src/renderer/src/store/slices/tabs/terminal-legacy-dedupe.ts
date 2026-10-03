import type { AppState } from '../../types'
import type { TerminalTab } from '../../../../../shared/terminal-tab-types'
import {
  isWebTerminalSurfaceTabId,
  toHostSessionTabId
} from '../../../../../shared/terminal-surface-id'
import { collectLeafIdsInOrder } from '@/components/terminal-pane/terminal-layout-leaf-ids'

type TerminalPtyEvidenceState = Pick<
  AppState,
  | 'ptyIdsByTabId'
  | 'lastKnownRelayPtyIdByTabId'
  | 'deferredSshSessionIdsByTabId'
  | 'pendingReconnectPtyIdByTabId'
  | 'terminalLayoutsByTabId'
>

function mountedLayoutPtyEvidence(state: TerminalPtyEvidenceState, tabId: string): string[] {
  const layout = state.terminalLayoutsByTabId[tabId]
  const bindings = Object.entries(layout?.ptyIdsByLeafId ?? {}).filter(([, ptyId]) =>
    Boolean(ptyId)
  )
  if (bindings.length === 0) {
    return []
  }
  if (layout?.root) {
    const mountedLeafIds = new Set(collectLeafIdsInOrder(layout.root))
    return bindings.filter(([leafId]) => mountedLeafIds.has(leafId)).map(([, ptyId]) => ptyId)
  }
  // A rootless snapshot proves only its sole binding, or the active binding
  // when stale off-tree leaves were never pruned.
  const provenLeafId = bindings.length === 1 ? bindings[0]?.[0] : layout?.activeLeafId
  return bindings.filter(([leafId]) => leafId === provenLeafId).map(([, ptyId]) => ptyId)
}

function terminalPtyEvidence(
  state: TerminalPtyEvidenceState,
  tab: Pick<TerminalTab, 'id' | 'ptyId'>
): string[] {
  return [
    ...(state.ptyIdsByTabId[tab.id] ?? []),
    ...(tab.ptyId ? [tab.ptyId] : []),
    ...(state.lastKnownRelayPtyIdByTabId[tab.id]
      ? [state.lastKnownRelayPtyIdByTabId[tab.id] as string]
      : []),
    ...(state.deferredSshSessionIdsByTabId[tab.id]
      ? [state.deferredSshSessionIdsByTabId[tab.id] as string]
      : []),
    ...(state.pendingReconnectPtyIdByTabId[tab.id]
      ? [state.pendingReconnectPtyIdByTabId[tab.id] as string]
      : []),
    ...mountedLayoutPtyEvidence(state, tab.id)
  ]
}

function terminalPtyEvidenceRank(
  state: TerminalPtyEvidenceState,
  tab: Pick<TerminalTab, 'id' | 'ptyId'>,
  ptyId: string
): number {
  if (state.ptyIdsByTabId[tab.id]?.includes(ptyId)) {
    return 3
  }
  if (
    state.pendingReconnectPtyIdByTabId[tab.id] === ptyId ||
    state.lastKnownRelayPtyIdByTabId[tab.id] === ptyId ||
    state.deferredSshSessionIdsByTabId[tab.id] === ptyId
  ) {
    return 2
  }
  if (mountedLayoutPtyEvidence(state, tab.id).includes(ptyId)) {
    return 1
  }
  return tab.ptyId === ptyId ? 1 : 0
}

function compareTerminalCandidates(
  state: TerminalPtyEvidenceState,
  ptyId: string,
  a: TerminalTab,
  b: TerminalTab
): number {
  const evidenceRank =
    terminalPtyEvidenceRank(state, b, ptyId) - terminalPtyEvidenceRank(state, a, ptyId)
  if (evidenceRank !== 0) {
    return evidenceRank
  }
  const mirrorRank =
    Number(isWebTerminalSurfaceTabId(b.id)) - Number(isWebTerminalSurfaceTabId(a.id))
  if (mirrorRank !== 0) {
    return mirrorRank
  }
  return a.sortOrder - b.sortOrder || a.createdAt - b.createdAt || a.id.localeCompare(b.id)
}

function terminalOwnershipEvidenceRank(
  state: TerminalPtyEvidenceState,
  tab: Pick<TerminalTab, 'id' | 'ptyId'>
): number {
  return terminalPtyEvidence(state, tab).reduce(
    (rank, ptyId) => Math.max(rank, terminalPtyEvidenceRank(state, tab, ptyId)),
    0
  )
}

function compareTerminalSurfaceAliases(
  state: TerminalPtyEvidenceState,
  a: TerminalTab,
  b: TerminalTab
): number {
  const evidenceRank =
    terminalOwnershipEvidenceRank(state, b) - terminalOwnershipEvidenceRank(state, a)
  if (evidenceRank !== 0) {
    return evidenceRank
  }
  const mirrorRank =
    Number(isWebTerminalSurfaceTabId(b.id)) - Number(isWebTerminalSurfaceTabId(a.id))
  if (mirrorRank !== 0) {
    return mirrorRank
  }
  return a.sortOrder - b.sortOrder || a.createdAt - b.createdAt || a.id.localeCompare(b.id)
}

/** Keep one deterministic owner when persisted terminal rows share a PTY. */
export function reconcileTerminalPtyOwners(
  state: TerminalPtyEvidenceState,
  tabs: readonly TerminalTab[]
): {
  duplicateIds: Set<string>
  releasedPtyIdsByTabId: Map<string, Set<string>>
} {
  const candidatesByPty = new Map<string, TerminalTab[]>()
  for (const tab of tabs) {
    for (const ptyId of new Set(terminalPtyEvidence(state, tab))) {
      const candidates = candidatesByPty.get(ptyId) ?? []
      candidates.push(tab)
      candidatesByPty.set(ptyId, candidates)
    }
  }

  const winnerByPty = new Map<string, string>()
  for (const [ptyId, candidates] of candidatesByPty) {
    const winner = [...candidates].sort((a, b) => compareTerminalCandidates(state, ptyId, a, b))[0]
    if (winner) {
      winnerByPty.set(ptyId, winner.id)
    }
  }

  const duplicateIds = new Set<string>()
  const releasedPtyIdsByTabId = new Map<string, Set<string>>()
  for (const tab of tabs) {
    const evidence = new Set(terminalPtyEvidence(state, tab))
    const releasedPtyIds = new Set(
      [...evidence].filter((ptyId) => winnerByPty.get(ptyId) !== tab.id)
    )
    if (evidence.size > 0 && releasedPtyIds.size === evidence.size) {
      duplicateIds.add(tab.id)
    } else if (releasedPtyIds.size > 0) {
      releasedPtyIdsByTabId.set(tab.id, releasedPtyIds)
    }
  }

  // A host surface and its deterministic web mirror are the same logical
  // terminal. Once an authoritative startup probe removes their shared dead
  // PTY, there is no PTY key left for the ownership pass above to group on.
  // Collapse only exact aliases when at least one side has no remaining PTY
  // evidence; two independently-live rows are left alone for their owner to
  // reconcile rather than risking destruction of a valid session.
  const tabById = new Map(tabs.map((tab) => [tab.id, tab]))
  for (const mirrorTab of tabs) {
    if (!isWebTerminalSurfaceTabId(mirrorTab.id)) {
      continue
    }
    const hostTab = tabById.get(toHostSessionTabId(mirrorTab.id))
    if (!hostTab) {
      continue
    }
    const hostEvidence = terminalPtyEvidence(state, hostTab)
    const mirrorEvidence = terminalPtyEvidence(state, mirrorTab)
    if (hostEvidence.length > 0 && mirrorEvidence.length > 0) {
      continue
    }
    const winner = [hostTab, mirrorTab].sort((a, b) =>
      compareTerminalSurfaceAliases(state, a, b)
    )[0]
    const loser = winner?.id === hostTab.id ? mirrorTab : hostTab
    duplicateIds.add(loser.id)
    releasedPtyIdsByTabId.delete(loser.id)
  }
  return {
    duplicateIds,
    releasedPtyIdsByTabId
  }
}
