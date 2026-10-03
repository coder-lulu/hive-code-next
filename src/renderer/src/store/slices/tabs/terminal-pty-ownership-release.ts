import type { AppState } from '../../types'
import { releaseTerminalLayoutPtyIds } from '../terminal-session-row-hydration'
import { resolvePtyBoundActiveLeafId } from '@/components/terminal-pane/terminal-layout-leaf-ids'

type TerminalPtyOwnershipReleaseState = Pick<
  AppState,
  | 'tabsByWorktree'
  | 'ptyIdsByTabId'
  | 'terminalLayoutsByTabId'
  | 'lastKnownRelayPtyIdByTabId'
  | 'deferredSshSessionIdsByTabId'
  | 'pendingReconnectPtyIdByTabId'
  | 'directSshLivePtyBindingByTabId'
  | 'sleepingAgentSessionsByPaneKey'
  | 'unreadTerminalPanes'
  | 'unreadAgentCompletionPanes'
  | 'unreadAgentCompletionCountByPane'
  | 'lastTerminalInputAtByPaneKey'
>

type RemovedTerminalAuxiliaryState = Pick<
  AppState,
  | 'lastKnownRelayPtyIdByTabId'
  | 'deferredSshSessionIdsByTabId'
  | 'pendingReconnectPtyIdByTabId'
  | 'pendingReconnectTabByWorktree'
  | 'unverifiedPtyLossTabIds'
  | 'directSshPaneRetryByTabId'
  | 'directSshLivePtyBindingByTabId'
  | 'directSshPaneRetryHistoryByTabId'
  | 'sleepingAgentSessionsByPaneKey'
  | 'unreadTerminalTabs'
  | 'unreadTerminalPanes'
  | 'unreadAgentCompletionPanes'
  | 'lastTerminalInputAtByPaneKey'
>

function withoutTabIds<T>(record: Readonly<Record<string, T>>, tabIds: ReadonlySet<string>) {
  return Object.fromEntries(
    Object.entries(record).filter(([tabId]) => !tabIds.has(tabId))
  ) as Record<string, T>
}

function withoutPaneKeysForTabs<T>(
  record: Readonly<Record<string, T>>,
  tabIds: ReadonlySet<string>
): Record<string, T> {
  return Object.fromEntries(
    Object.entries(record).filter(([paneKey]) => {
      for (const tabId of tabIds) {
        if (paneKey.startsWith(`${tabId}:`)) {
          return false
        }
      }
      return true
    })
  )
}

function withoutPaneKeys<T>(
  record: Readonly<Record<string, T>>,
  paneKeys: ReadonlySet<string>
): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([paneKey]) => !paneKeys.has(paneKey)))
}

export function buildRemovedTerminalAuxiliaryStatePatch(
  state: RemovedTerminalAuxiliaryState,
  worktreeId: string,
  removedTabIds: ReadonlySet<string>
): RemovedTerminalAuxiliaryState {
  return {
    lastKnownRelayPtyIdByTabId: withoutTabIds(state.lastKnownRelayPtyIdByTabId, removedTabIds),
    deferredSshSessionIdsByTabId: withoutTabIds(state.deferredSshSessionIdsByTabId, removedTabIds),
    pendingReconnectPtyIdByTabId: withoutTabIds(state.pendingReconnectPtyIdByTabId, removedTabIds),
    pendingReconnectTabByWorktree: {
      ...state.pendingReconnectTabByWorktree,
      [worktreeId]: (state.pendingReconnectTabByWorktree[worktreeId] ?? []).filter(
        (tabId) => !removedTabIds.has(tabId)
      )
    },
    unverifiedPtyLossTabIds: withoutTabIds(state.unverifiedPtyLossTabIds, removedTabIds),
    directSshPaneRetryByTabId: withoutTabIds(state.directSshPaneRetryByTabId, removedTabIds),
    directSshLivePtyBindingByTabId: withoutTabIds(
      state.directSshLivePtyBindingByTabId,
      removedTabIds
    ),
    directSshPaneRetryHistoryByTabId: withoutTabIds(
      state.directSshPaneRetryHistoryByTabId,
      removedTabIds
    ),
    sleepingAgentSessionsByPaneKey: withoutPaneKeysForTabs(
      state.sleepingAgentSessionsByPaneKey,
      removedTabIds
    ),
    unreadTerminalTabs: withoutTabIds(state.unreadTerminalTabs, removedTabIds),
    unreadTerminalPanes: withoutPaneKeysForTabs(state.unreadTerminalPanes, removedTabIds),
    unreadAgentCompletionPanes: withoutPaneKeysForTabs(
      state.unreadAgentCompletionPanes,
      removedTabIds
    ),
    lastTerminalInputAtByPaneKey: withoutPaneKeysForTabs(
      state.lastTerminalInputAtByPaneKey,
      removedTabIds
    )
  }
}

export function buildTerminalPtyOwnershipReleasePatch(
  state: TerminalPtyOwnershipReleaseState,
  worktreeId: string,
  releasedPtyIdsByTabId: ReadonlyMap<string, ReadonlySet<string>>
): Pick<
  AppState,
  | 'tabsByWorktree'
  | 'ptyIdsByTabId'
  | 'terminalLayoutsByTabId'
  | 'lastKnownRelayPtyIdByTabId'
  | 'deferredSshSessionIdsByTabId'
  | 'pendingReconnectPtyIdByTabId'
  | 'directSshLivePtyBindingByTabId'
  | 'sleepingAgentSessionsByPaneKey'
  | 'unreadTerminalPanes'
  | 'unreadAgentCompletionPanes'
  | 'unreadAgentCompletionCountByPane'
  | 'lastTerminalInputAtByPaneKey'
> {
  const tabsByWorktree = {
    ...state.tabsByWorktree,
    [worktreeId]: (state.tabsByWorktree[worktreeId] ?? []).map((tab) => {
      const released = releasedPtyIdsByTabId.get(tab.id)
      return tab.ptyId && released?.has(tab.ptyId) ? { ...tab, ptyId: null } : tab
    })
  }
  const ptyIdsByTabId = { ...state.ptyIdsByTabId }
  const terminalLayoutsByTabId = { ...state.terminalLayoutsByTabId }
  const lastKnownRelayPtyIdByTabId = { ...state.lastKnownRelayPtyIdByTabId }
  const deferredSshSessionIdsByTabId = { ...state.deferredSshSessionIdsByTabId }
  const pendingReconnectPtyIdByTabId = { ...state.pendingReconnectPtyIdByTabId }
  const directSshLivePtyBindingByTabId = { ...state.directSshLivePtyBindingByTabId }
  const releasedPaneKeys = new Set<string>()

  for (const [tabId, releasedPtyIds] of releasedPtyIdsByTabId) {
    const ptyIds = ptyIdsByTabId[tabId]
    if (ptyIds) {
      ptyIdsByTabId[tabId] = ptyIds.filter((ptyId) => !releasedPtyIds.has(ptyId))
    }
    const layout = terminalLayoutsByTabId[tabId]
    if (layout) {
      for (const [leafId, ptyId] of Object.entries(layout.ptyIdsByLeafId ?? {})) {
        if (releasedPtyIds.has(ptyId)) {
          releasedPaneKeys.add(`${tabId}:${leafId}`)
        }
      }
      const releasedLayout = releaseTerminalLayoutPtyIds(layout, releasedPtyIds)
      terminalLayoutsByTabId[tabId] = {
        ...releasedLayout,
        activeLeafId: resolvePtyBoundActiveLeafId({
          root: releasedLayout.root,
          activeLeafId: releasedLayout.activeLeafId,
          ptyIdsByLeafId: releasedLayout.ptyIdsByLeafId
        })
      }
    }
    if (releasedPtyIds.has(lastKnownRelayPtyIdByTabId[tabId] ?? '')) {
      delete lastKnownRelayPtyIdByTabId[tabId]
    }
    if (releasedPtyIds.has(deferredSshSessionIdsByTabId[tabId] ?? '')) {
      delete deferredSshSessionIdsByTabId[tabId]
    }
    if (releasedPtyIds.has(pendingReconnectPtyIdByTabId[tabId] ?? '')) {
      delete pendingReconnectPtyIdByTabId[tabId]
    }
    if (releasedPtyIds.has(directSshLivePtyBindingByTabId[tabId]?.ptyId ?? '')) {
      delete directSshLivePtyBindingByTabId[tabId]
    }
  }

  return {
    tabsByWorktree,
    ptyIdsByTabId,
    terminalLayoutsByTabId,
    lastKnownRelayPtyIdByTabId,
    deferredSshSessionIdsByTabId,
    pendingReconnectPtyIdByTabId,
    directSshLivePtyBindingByTabId,
    sleepingAgentSessionsByPaneKey: withoutPaneKeys(
      state.sleepingAgentSessionsByPaneKey,
      releasedPaneKeys
    ),
    unreadTerminalPanes: withoutPaneKeys(state.unreadTerminalPanes, releasedPaneKeys),
    unreadAgentCompletionPanes: withoutPaneKeys(state.unreadAgentCompletionPanes, releasedPaneKeys),
    unreadAgentCompletionCountByPane: withoutPaneKeys(
      state.unreadAgentCompletionCountByPane,
      releasedPaneKeys
    ),
    lastTerminalInputAtByPaneKey: withoutPaneKeys(
      state.lastTerminalInputAtByPaneKey,
      releasedPaneKeys
    )
  }
}
