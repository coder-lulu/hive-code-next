import { useCallback, useMemo, useState } from 'react'
import { useAppStore } from '@/store'
import { isActiveSidebarWorkspace } from '../../../../shared/sidebar-list/active-workspace'
import {
  isWorktreeHostIdentity,
  getWorktreeIdFromHostIdentity,
  getExecutionHostIdFromWorktreeHostIdentity
} from '../../../../shared/worktree/host-qualified-identity'

export type WorktreeAgentExpansionState = {
  collapsedLineageParents: ReadonlySet<string>
  compactRootListExpanded: boolean
}

const EMPTY_COLLAPSED_PARENTS: ReadonlySet<string> = new Set()

const DEFAULT_EXPANSION_STATE: WorktreeAgentExpansionState = {
  collapsedLineageParents: EMPTY_COLLAPSED_PARENTS,
  compactRootListExpanded: false
}

// Retain disclosures across virtualizer/lineage remounts in a bounded renderer-session cache; reload resets them.
export const MAX_PERSISTED_WORKTREE_AGENT_EXPANSIONS = 512
type PersistedExpansionState = WorktreeAgentExpansionState & { compactRootListTouched?: true }
const expansionByWorktreeId = new Map<string, PersistedExpansionState>()

function trimPersistedExpansions(): void {
  while (expansionByWorktreeId.size > MAX_PERSISTED_WORKTREE_AGENT_EXPANSIONS) {
    const oldest = expansionByWorktreeId.keys().next().value
    if (oldest === undefined) {
      break
    }
    expansionByWorktreeId.delete(oldest)
  }
}

function readExpansionState(worktreeId: string, active = false): PersistedExpansionState {
  const saved = expansionByWorktreeId.get(worktreeId)
  return {
    ...(saved ?? DEFAULT_EXPANSION_STATE),
    compactRootListExpanded: saved?.compactRootListTouched
      ? saved.compactRootListExpanded
      : active || (saved?.compactRootListExpanded ?? false)
  }
}

function persistExpansionState(worktreeId: string, state: PersistedExpansionState): void {
  // Refresh LRU order; an explicit collapse must survive an active-workspace default.
  expansionByWorktreeId.delete(worktreeId)
  if (
    state.compactRootListTouched ||
    state.compactRootListExpanded ||
    state.collapsedLineageParents.size > 0
  ) {
    expansionByWorktreeId.set(worktreeId, state)
    trimPersistedExpansions()
  }
}

export type WorktreeAgentExpansionControls = {
  collapsedLineageParents: ReadonlySet<string>
  compactRootListExpanded: boolean
  toggleLineageParent: (paneKey: string) => void
  toggleCompactRootList: () => void
}

/** Restore each worktree’s disclosures across virtualizer and sibling-lineage remounts. */
export function useWorktreeAgentExpansionState(worktreeId: string): WorktreeAgentExpansionControls {
  const active = useAppStore(
    (state) =>
      state.activeView === 'terminal' &&
      isActiveSidebarWorkspace(
        isWorktreeHostIdentity(worktreeId)
          ? {
              id: getWorktreeIdFromHostIdentity(worktreeId),
              hostId: getExecutionHostIdFromWorktreeHostIdentity(worktreeId)
            }
          : { id: worktreeId },
        { worktreeId: state.activeWorktreeId, hostId: state.activeWorkspaceExecutionHostId ?? null }
      )
  )
  const [, rerender] = useState(0)
  const current = readExpansionState(worktreeId, active)

  const commit = useCallback(
    (next: PersistedExpansionState) => {
      persistExpansionState(worktreeId, next)
      rerender((revision) => revision + 1)
    },
    [worktreeId]
  )

  const toggleLineageParent = useCallback(
    (paneKey: string) => {
      const base = readExpansionState(worktreeId, active)
      const nextParents = new Set(base.collapsedLineageParents)
      if (nextParents.has(paneKey)) {
        nextParents.delete(paneKey)
      } else {
        nextParents.add(paneKey)
      }
      commit({ ...base, collapsedLineageParents: nextParents })
    },
    [active, commit, worktreeId]
  )

  const toggleCompactRootList = useCallback(() => {
    const base = readExpansionState(worktreeId, active)
    commit({
      ...base,
      compactRootListExpanded: !base.compactRootListExpanded,
      compactRootListTouched: true
    })
  }, [active, commit, worktreeId])

  return useMemo(
    () => ({
      collapsedLineageParents: current.collapsedLineageParents,
      compactRootListExpanded: current.compactRootListExpanded,
      toggleLineageParent,
      toggleCompactRootList
    }),
    [
      current.collapsedLineageParents,
      current.compactRootListExpanded,
      toggleLineageParent,
      toggleCompactRootList
    ]
  )
}

export function clearWorktreeAgentExpansionStateForTests(): void {
  expansionByWorktreeId.clear()
}

export function getWorktreeAgentExpansionCountForTests(): number {
  return expansionByWorktreeId.size
}

export function seedWorktreeAgentExpansionStateForTests(
  worktreeId: string,
  state: WorktreeAgentExpansionState
): void {
  persistExpansionState(worktreeId, state)
}
