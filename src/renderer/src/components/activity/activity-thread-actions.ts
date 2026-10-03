import { isFloatingTerminalWorkspaceId } from '@/lib/floating-terminal'
import { resolveTemporarySessionOwner } from '@/lib/temporary-session-navigation'
import { activateTabAndFocusPane } from '@/lib/activate-tab-and-focus-pane'
import { activateStructuredAgentSessionTab } from '@/lib/structured-agent-session-tab-activation'
import { jumpToWorktreeFromSidebar } from '@/lib/worktree-jump-navigation'
import { activateAndRevealWorkspace } from '@/lib/worktree-activation'
import { useAppStore } from '@/store'
import {
  getSettingsFocusedExecutionHostId,
  getWorktreeExecutionHostId,
  type ExecutionHostId
} from '../../../../shared/execution-host'
import { findKnownWorktreeById } from '@/store/slices/worktrees/listing/detected-worktree-meta'
import type { AppState } from '@/store/types'
import type { AgentPaneThread } from './activity-thread-types'
import { parsePaneKey } from '../../../../shared/stable-pane-id'

// Same focused-host fallback the Agents scope filter uses; defaulting to `local` here would
// look up a hostless runtime-owned workspace on the wrong host and silently drop the jump.
function getActivityThreadExecutionHostId(
  thread: AgentPaneThread,
  defaultHostId: ExecutionHostId
): ExecutionHostId {
  return getWorktreeExecutionHostId(thread.worktree, thread.repo ?? undefined, defaultHostId)
}

type ActivityThreadWorkspaceCatalog = Pick<
  AppState,
  'worktreesByRepo' | 'detectedWorktreesByRepo' | 'folderWorkspaces'
> & { defaultHostId: ExecutionHostId }

function readActivityThreadWorkspaceCatalog(): ActivityThreadWorkspaceCatalog {
  const state = useAppStore.getState()
  return { ...state, defaultHostId: getSettingsFocusedExecutionHostId(state.settings) }
}

function openThreadTarget(thread: AgentPaneThread, executionHostId: ExecutionHostId): void {
  const state = useAppStore.getState()

  if (isFloatingTerminalWorkspaceId(thread.worktree.id)) {
    const owner = resolveTemporarySessionOwner(state, {
      ownerBucketKey: thread.worktree.id,
      tabId: thread.tab.id,
      executionHostId
    })
    const tabId = owner?.unifiedTabId ?? owner?.terminalTabId
    // Use the same list and selection identity as the sidebar Sessions entry.
    state.openSessionsPage({ kind: 'all' })
    state.updateSessionsView({
      navigation: 'sessions',
      query: '',
      scrollTop: 0,
      selectedSessionKey: owner && tabId ? `${owner.bucketKey}|${tabId}` : null
    })
    return
  }

  // Reuse the existing Projects navigation surface. It owns the project/workspace
  // hierarchy and the normal activation path selects the exact worktree there.
  state.openSessionsPage()
  state.updateSessionsView({ navigation: 'projects', query: '' })
  if (hasActivityThreadWorkspace(thread)) {
    if (activateAndRevealWorkspace(thread.worktree.id, { executionHostId }) === false) {
      return
    }
    if (
      activateStructuredAgentSessionTab({
        worktreeId: thread.worktree.id,
        tabId: thread.tab.id,
        executionHostId
      })
    ) {
      return
    }
    const activated = useAppStore.getState()
    if (
      !(activated.tabsByWorktree[thread.worktree.id] ?? []).some((tab) => tab.id === thread.tab.id)
    ) {
      return
    }
    activated.setActiveTabType('terminal', thread.worktree.id)
    const parsed = parsePaneKey(thread.paneKey)
    activateTabAndFocusPane(thread.tab.id, parsed?.tabId === thread.tab.id ? parsed.leafId : null, {
      flashFocusedPane: true,
      scrollToBottomIfOutputSinceLastView: true
    })
  }
}

export function hasActivityThreadWorkspace(
  thread: AgentPaneThread,
  catalog: ActivityThreadWorkspaceCatalog = readActivityThreadWorkspaceCatalog()
): boolean {
  return Boolean(
    findKnownWorktreeById(
      catalog,
      thread.worktree.id,
      getActivityThreadExecutionHostId(thread, catalog.defaultHostId)
    )
  )
}

export function createActivityThreadActions({
  getMarkAllReadThreads,
  acknowledgeAgents,
  unacknowledgeAgents,
  setSelectedPaneKey
}: {
  /** Getter (not a snapshot) so the handlers keep one identity for the row memo
   *  bail-outs while bulk actions still see the current thread set. This is the
   *  badge-coherent set (child-filter only), not the search/scope-narrowed one,
   *  so Mark all read always drives the Agents badge to zero. */
  getMarkAllReadThreads: () => AgentPaneThread[]
  acknowledgeAgents: (paneKeys: string[]) => void
  unacknowledgeAgents: (paneKeys: string[]) => void
  setSelectedPaneKey: (paneKey: string | null) => void
}): {
  markThreadRead: (thread: AgentPaneThread) => void
  markThreadUnread: (thread: AgentPaneThread) => void
  selectThread: (thread: AgentPaneThread) => void
  jumpToWorkspace: (thread: AgentPaneThread) => void
  markAllThreadsRead: () => void
} {
  const markThreadRead = (thread: AgentPaneThread): void => {
    acknowledgeAgents([thread.paneKey])
  }

  const markThreadUnread = (thread: AgentPaneThread): void => {
    unacknowledgeAgents([thread.paneKey])
  }

  const selectThread = (thread: AgentPaneThread): void => {
    setSelectedPaneKey(thread.paneKey)
    markThreadRead(thread)
    openThreadTarget(
      thread,
      getActivityThreadExecutionHostId(
        thread,
        getSettingsFocusedExecutionHostId(useAppStore.getState().settings)
      )
    )
  }

  const jumpToWorkspace = (thread: AgentPaneThread): void => {
    const catalog = readActivityThreadWorkspaceCatalog()
    if (!hasActivityThreadWorkspace(thread, catalog)) {
      return
    }
    markThreadRead(thread)
    jumpToWorktreeFromSidebar(thread.worktree.id, {
      executionHostId: getActivityThreadExecutionHostId(thread, catalog.defaultHostId)
    })
  }

  const markAllThreadsRead = (): void => {
    const unreadKeys = getMarkAllReadThreads()
      .filter((t) => t.unread)
      .map((t) => t.paneKey)
    if (unreadKeys.length === 0) {
      return
    }
    acknowledgeAgents(unreadKeys)
  }

  return {
    markThreadRead,
    markThreadUnread,
    selectThread,
    jumpToWorkspace,
    markAllThreadsRead
  }
}
