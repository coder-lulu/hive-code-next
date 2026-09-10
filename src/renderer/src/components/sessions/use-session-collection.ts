import { useMemo } from 'react'
import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import { selectExecutionHostDisplayLabel } from '@/lib/execution-host-display-label'
import { resolveSessionConnectionState } from '@/lib/session-navigation'
import { buildSessionInventoryProjection, projectSessionHookStatus } from './session-list-model'
import { useSessionJournalStatuses } from './use-session-journal-statuses'
import { selectSessionCatalog } from './session-catalog'
import type { SessionListItem, SessionProjectOption } from './session-list-types'

/** Cache a read-only projection at the store boundary, including semantic freshness epochs. */
export function createSessionCollectionSelector() {
  let previous: readonly unknown[] | undefined
  let result: { items: SessionListItem[]; projects: SessionProjectOption[] } | undefined
  return (state: AppState) => {
    const catalog = selectSessionCatalog(state)
    const dependencies = [
      catalog,
      state.unifiedTabsByWorktree,
      state.tabsByWorktree,
      state.terminalLayoutsByTabId,
      state.agentStatusEpoch,
      state.runtimeStatusByEnvironmentId,
      state.sshConnectionStates,
      state.sshStateByEnvironment,
      state.sshTargetLabels,
      state.settings
    ]
    if (result && dependencies.every((value, index) => value === previous?.[index])) {
      return result
    }
    const now = Date.now()
    const input = {
      unifiedTabsByWorktree: state.unifiedTabsByWorktree,
      tabsByWorktree: state.tabsByWorktree,
      entities: catalog.entities,
      agentStatusByPaneKey: state.agentStatusByPaneKey,
      terminalLayoutsByTabId: state.terminalLayoutsByTabId,
      now
    }
    const { items: inventory, matchHook } = buildSessionInventoryProjection(input)
    const items = inventory.map((item) => {
      const connection =
        item.executionHostId && item.ownerBucketKey
          ? resolveSessionConnectionState(state, item.ownerBucketKey, item.executionHostId)
          : 'unknown'
      return {
        ...projectSessionHookStatus(item, matchHook(item), connection, now),
        hostLabel: item.executionHostId
          ? selectExecutionHostDisplayLabel(state, item.executionHostId)
          : ''
      }
    })
    previous = dependencies
    result = { items, projects: catalog.projects }
    return result
  }
}

const selectSessionCollection = createSessionCollectionSelector()

export function useSessionCollection() {
  const projection = useAppStore(selectSessionCollection)
  const items = useSessionJournalStatuses(projection.items)
  return useMemo(
    () => ({
      items: [...items].sort(
        (a, b) => b.lastActivityAt - a.lastActivityAt || a.key.localeCompare(b.key)
      ),
      projects: projection.projects
    }),
    [items, projection.projects]
  )
}
