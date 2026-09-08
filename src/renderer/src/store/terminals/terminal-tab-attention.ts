import { scheduleRuntimeGraphSync } from '@/runtime/sync-runtime-graph'
import { resolveTerminalWorktreeRoute } from '@/lib/terminal-worktree-route'
import type { TerminalSlice, TerminalStoreGet, TerminalStoreSet } from './terminal-state'
import { findRenamableUnifiedTab } from './renamable-unified-tab'

function consumeAgentCompletionPatch(state: TerminalSlice, paneKey: string) {
  const currentCounts = state.unreadAgentCompletionCountByPane ?? {}
  const currentCount = currentCounts[paneKey] ?? 0
  if (currentCount <= 0) {
    return null
  }

  const nextCounts = { ...currentCounts }
  const nextPanes = { ...state.unreadAgentCompletionPanes }
  if (currentCount > 1) {
    nextCounts[paneKey] = currentCount - 1
    nextPanes[paneKey] = true
  } else {
    delete nextCounts[paneKey]
    delete nextPanes[paneKey]
  }
  return {
    unreadAgentCompletionCountByPane: nextCounts,
    unreadAgentCompletionPanes: nextPanes
  }
}

export function createTerminalTabAttentionActions(
  set: TerminalStoreSet,
  get: TerminalStoreGet
): Pick<
  TerminalSlice,
  | 'markTerminalTabUnread'
  | 'markTerminalPaneUnread'
  | 'markAgentCompletionPaneUnread'
  | 'incrementAgentCompletionUnread'
  | 'consumeAgentCompletionUnread'
  | 'consumeFirstAgentCompletionUnreadForTab'
  | 'clearTerminalTabUnread'
  | 'clearTerminalPaneUnread'
  | 'setTabCustomTitle'
  | 'setTabColor'
> {
  return {
    markTerminalTabUnread: (tabId) => {
      const state = get()
      const ownerTab = Object.values(state.tabsByWorktree ?? {})
        .flat()
        .find((t) => t.id === tabId)
      if (!ownerTab) {
        return
      }
      // Why: terminal attention persists until real interaction.
      set((s) => {
        if (s.unreadTerminalTabs[tabId]) {
          return s
        }
        return { unreadTerminalTabs: { ...s.unreadTerminalTabs, [tabId]: true as const } }
      })
    },
    markTerminalPaneUnread: (paneKey) => {
      set((s) => {
        if (s.unreadTerminalPanes[paneKey]) {
          return s
        }
        return { unreadTerminalPanes: { ...s.unreadTerminalPanes, [paneKey]: true as const } }
      })
    },
    markAgentCompletionPaneUnread: (paneKey) => {
      set((s) => {
        if (s.unreadAgentCompletionPanes[paneKey]) {
          return s
        }
        return {
          unreadAgentCompletionPanes: {
            ...s.unreadAgentCompletionPanes,
            [paneKey]: true as const
          }
        }
      })
    },
    incrementAgentCompletionUnread: (paneKey) => {
      set((s) => {
        const currentCounts = s.unreadAgentCompletionCountByPane ?? {}
        return {
          unreadAgentCompletionCountByPane: {
            ...currentCounts,
            [paneKey]: (currentCounts[paneKey] ?? 0) + 1
          }
        }
      })
    },
    consumeAgentCompletionUnread: (paneKey) => {
      set((s) => consumeAgentCompletionPatch(s, paneKey) ?? s)
    },
    consumeFirstAgentCompletionUnreadForTab: (tabId) => {
      set((s) => {
        const paneKey = Object.keys(s.unreadAgentCompletionCountByPane ?? {}).find((key) =>
          key.startsWith(`${tabId}:`)
        )
        return paneKey ? (consumeAgentCompletionPatch(s, paneKey) ?? s) : s
      })
    },
    clearTerminalTabUnread: (tabId) => {
      set((s) => {
        if (!s.unreadTerminalTabs[tabId]) {
          return s
        }
        const copy = { ...s.unreadTerminalTabs }
        delete copy[tabId]
        return { unreadTerminalTabs: copy }
      })
    },
    clearTerminalPaneUnread: (paneKey, options) => {
      set((s) => {
        const consumeCompletion = options?.consumeCompletion ?? true
        const currentCompletionCounts = s.unreadAgentCompletionCountByPane ?? {}
        const completionCount = currentCompletionCounts[paneKey] ?? 0
        if (
          !s.unreadTerminalPanes[paneKey] &&
          !s.unreadAgentCompletionPanes[paneKey] &&
          (!consumeCompletion || completionCount === 0)
        ) {
          return s
        }
        const nextUnreadTerminalPanes = { ...s.unreadTerminalPanes }
        const preserveCompletionMarker = !consumeCompletion && completionCount > 0
        const nextUnreadAgentCompletionPanes = preserveCompletionMarker
          ? s.unreadAgentCompletionPanes
          : { ...s.unreadAgentCompletionPanes }
        delete nextUnreadTerminalPanes[paneKey]
        const completionPatch = consumeCompletion ? consumeAgentCompletionPatch(s, paneKey) : null
        if (completionPatch) {
          return {
            unreadTerminalPanes: nextUnreadTerminalPanes,
            ...completionPatch
          }
        }
        if (!preserveCompletionMarker) {
          delete nextUnreadAgentCompletionPanes[paneKey]
        }
        return {
          unreadTerminalPanes: nextUnreadTerminalPanes,
          ...(nextUnreadAgentCompletionPanes !== s.unreadAgentCompletionPanes
            ? { unreadAgentCompletionPanes: nextUnreadAgentCompletionPanes }
            : {})
        }
      })
    },
    setTabCustomTitle: (tabId, title, opts) => {
      set((s) => {
        const next = { ...s.tabsByWorktree }
        for (const wId of Object.keys(next)) {
          next[wId] = next[wId].map((t) => (t.id === tabId ? { ...t, customTitle: title } : t))
        }
        scheduleRuntimeGraphSync()
        return { tabsByWorktree: next }
      })
      const item = findRenamableUnifiedTab(get().unifiedTabsByWorktree, tabId)
      if (item) {
        get().setTabCustomLabel(item.id, title, opts)
      }
    },
    setTabColor: (tabId, color) => {
      set((s) => {
        const next = { ...s.tabsByWorktree }
        for (const wId of Object.keys(next)) {
          next[wId] = next[wId].map((t) => (t.id === tabId ? { ...t, color } : t))
        }
        return { tabsByWorktree: next }
      })
      const item = findRenamableUnifiedTab(get().unifiedTabsByWorktree, tabId)
      if (item) {
        get().setUnifiedTabColor(item.id, color)
        // Why: tab color is host-authoritative for remote-server tabs; mirror it so it persists instead of reverting on the next snapshot.
        const state = get()
        const owningWorktreeId = Object.keys(state.unifiedTabsByWorktree).find((wId) =>
          (state.unifiedTabsByWorktree[wId] ?? []).some((entry) => entry.id === item.id)
        )
        if (
          owningWorktreeId &&
          resolveTerminalWorktreeRoute(state, owningWorktreeId)?.runtimeEnvironmentId
        ) {
          void import('@/runtime/web-runtime-session').then(({ setWebRuntimeTabProps }) =>
            setWebRuntimeTabProps({ worktreeId: owningWorktreeId, tabId: item.id, color })
          )
        }
      }
    }
  }
}
