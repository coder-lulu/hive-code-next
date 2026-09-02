import { useMemo } from 'react'
import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import {
  buildTemporarySessionCollection,
  temporarySessionIdentityKey,
  type TemporarySessionCollectionInput,
  type TemporarySessionItem
} from '@/components/sidebar/sidebar-session-model'
import { isFloatingWorktreeId } from '@/components/sidebar/sidebar-session-projection'

type UnifiedBuckets = NonNullable<TemporarySessionCollectionInput['unifiedTabsByWorktree']>
type TerminalBuckets = NonNullable<TemporarySessionCollectionInput['tabsByWorktree']>

type TemporarySessionStoreSelection = {
  unifiedTabsByWorktree: UnifiedBuckets
  tabsByWorktree: TerminalBuckets
  retainedAgentsByPaneKey: AppState['retainedAgentsByPaneKey']
  agentStatusEpoch: number
}

function pickTemporaryBuckets<Value>(
  source: Readonly<Record<string, Value | undefined>>
): Readonly<Record<string, Value | undefined>> {
  const buckets: Record<string, Value | undefined> = {}
  for (const [bucketKey, value] of Object.entries(source)) {
    if (isFloatingWorktreeId(bucketKey)) {
      buckets[bucketKey] = value
    }
  }
  return buckets
}

function bucketRecordsEqual<Value>(
  left: Readonly<Record<string, Value | undefined>>,
  right: Readonly<Record<string, Value | undefined>>
): boolean {
  const leftKeys = Object.keys(left)
  if (leftKeys.length !== Object.keys(right).length) {
    return false
  }
  return leftKeys.every((key) => Object.hasOwn(right, key) && left[key] === right[key])
}

function createTemporarySessionStoreSelector(): (
  state: AppState
) => TemporarySessionStoreSelection {
  let unifiedSource: AppState['unifiedTabsByWorktree'] | undefined
  let terminalSource: AppState['tabsByWorktree'] | undefined
  let unifiedBuckets: UnifiedBuckets = {}
  let terminalBuckets: TerminalBuckets = {}
  let selection: TemporarySessionStoreSelection | undefined

  return (state) => {
    if (state.unifiedTabsByWorktree !== unifiedSource) {
      const next = pickTemporaryBuckets(state.unifiedTabsByWorktree)
      if (!bucketRecordsEqual(unifiedBuckets, next)) {
        unifiedBuckets = next
      }
      unifiedSource = state.unifiedTabsByWorktree
    }
    if (state.tabsByWorktree !== terminalSource) {
      const next = pickTemporaryBuckets(state.tabsByWorktree)
      if (!bucketRecordsEqual(terminalBuckets, next)) {
        terminalBuckets = next
      }
      terminalSource = state.tabsByWorktree
    }
    if (
      selection &&
      selection.unifiedTabsByWorktree === unifiedBuckets &&
      selection.tabsByWorktree === terminalBuckets &&
      selection.retainedAgentsByPaneKey === state.retainedAgentsByPaneKey &&
      selection.agentStatusEpoch === state.agentStatusEpoch
    ) {
      return selection
    }
    selection = {
      unifiedTabsByWorktree: unifiedBuckets,
      tabsByWorktree: terminalBuckets,
      retainedAgentsByPaneKey: state.retainedAgentsByPaneKey,
      agentStatusEpoch: state.agentStatusEpoch
    }
    return selection
  }
}

export type { TemporarySessionItem }
export { temporarySessionIdentityKey }

export function useTemporarySessionCollection(options?: { limit?: number }): {
  items: TemporarySessionItem[]
  totalCount: number
} {
  const selector = useMemo(() => createTemporarySessionStoreSelector(), [])
  const selection = useAppStore(selector)
  const limit = options?.limit

  return useMemo(() => {
    // The epoch publishes semantic live-status changes. Read the live map only
    // after that signal so same-state heartbeat map copies cannot rerender or
    // rebuild the temporary-session collection.
    void selection.agentStatusEpoch
    return buildTemporarySessionCollection(
      {
        unifiedTabsByWorktree: selection.unifiedTabsByWorktree,
        tabsByWorktree: selection.tabsByWorktree,
        agentStatusByPaneKey: useAppStore.getState().agentStatusByPaneKey,
        retainedAgentsByPaneKey: selection.retainedAgentsByPaneKey
      },
      { limit }
    )
  }, [limit, selection])
}
