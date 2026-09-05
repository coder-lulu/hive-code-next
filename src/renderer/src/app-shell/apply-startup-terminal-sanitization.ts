import type { StoreApi } from 'zustand'
import type { AppState } from '../store/types'
import type { TerminalTab } from '../../../shared/terminal-tab-types'
import type { WorkspaceSessionState } from '../../../shared/workspace-session-state-types'
import { buildTerminalPtyOwnershipReleasePatch } from '../store/slices/tabs/terminal-pty-ownership-release'
import { collectRemovedPersistedPtyIds } from './sanitize-persisted-terminal-session'

type StartupTerminalStore = Pick<StoreApi<AppState>, 'getState' | 'setState'>

function collectCurrentTabPtyIds(state: AppState, tab: TerminalTab): Set<string> {
  return new Set(
    [
      tab.ptyId,
      ...(state.ptyIdsByTabId[tab.id] ?? []),
      state.lastKnownRelayPtyIdByTabId[tab.id],
      state.deferredSshSessionIdsByTabId[tab.id],
      state.pendingReconnectPtyIdByTabId[tab.id],
      state.directSshLivePtyBindingByTabId[tab.id]?.ptyId,
      ...Object.values(state.terminalLayoutsByTabId[tab.id]?.ptyIdsByLeafId ?? {})
    ].filter((ptyId): ptyId is string => typeof ptyId === 'string' && ptyId.length > 0)
  )
}

/**
 * Apply only liveness bindings removed by a probe that completed after base
 * hydration. Current non-matching bindings are preserved so a successful
 * reconnect or user-created replacement cannot be rolled back by late work.
 */
export function applyLatePersistedTerminalSessionSanitization(
  store: StartupTerminalStore,
  original: WorkspaceSessionState,
  sanitized: WorkspaceSessionState
): void {
  const deadPtyIds = collectRemovedPersistedPtyIds(original, sanitized)
  if (deadPtyIds.size === 0) {
    return
  }

  for (const worktreeId of Object.keys(store.getState().tabsByWorktree)) {
    const state = store.getState()
    const releasedPtyIdsByTabId = new Map<string, Set<string>>()
    const retirePromotedLegacyTabIds = new Set<string>()
    const originalUnifiedTerminalIds = new Set(
      (original.unifiedTabs?.[worktreeId] ?? [])
        .filter((tab) => tab.contentType === 'terminal')
        .map((tab) => tab.entityId)
    )
    for (const tab of state.tabsByWorktree[worktreeId] ?? []) {
      const currentPtyIds = collectCurrentTabPtyIds(state, tab)
      const releasedPtyIds = new Set([...currentPtyIds].filter((ptyId) => deadPtyIds.has(ptyId)))
      if (releasedPtyIds.size > 0) {
        releasedPtyIdsByTabId.set(tab.id, releasedPtyIds)
        if (!originalUnifiedTerminalIds.has(tab.id) && releasedPtyIds.size === currentPtyIds.size) {
          retirePromotedLegacyTabIds.add(tab.id)
        }
      }
    }
    if (releasedPtyIdsByTabId.size === 0) {
      continue
    }
    store.setState(buildTerminalPtyOwnershipReleasePatch(state, worktreeId, releasedPtyIdsByTabId))
    if (retirePromotedLegacyTabIds.size > 0) {
      const current = store.getState()
      store.setState({
        unifiedTabsByWorktree: {
          ...current.unifiedTabsByWorktree,
          [worktreeId]: (current.unifiedTabsByWorktree[worktreeId] ?? []).filter(
            (tab) => tab.contentType !== 'terminal' || !retirePromotedLegacyTabIds.has(tab.entityId)
          )
        }
      })
    }
    store.getState().reconcileWorktreeTabModel(worktreeId)
  }
}

export function scheduleLatePersistedTerminalSessionSanitization(
  store: StartupTerminalStore,
  original: WorkspaceSessionState,
  pending: Promise<WorkspaceSessionState> | null | undefined,
  isCancelled: () => boolean
): void {
  if (!pending) {
    return
  }
  void pending
    .then((sanitizedSession) => {
      if (!isCancelled()) {
        applyLatePersistedTerminalSessionSanitization(store, original, sanitizedSession)
      }
    })
    .catch((error) => {
      console.warn('Late persisted terminal sanitization failed:', error)
    })
}
