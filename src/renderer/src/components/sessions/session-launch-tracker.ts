import type { ExecutionHostId } from '../../../../shared/execution-host'
import type { TuiAgent } from '../../../../shared/tui-agent'
import { useAppStore } from '@/store'
import type { SessionListItem } from './session-list-types'
import { createSessionCollectionSelector } from './use-session-collection'

type SessionLaunchTrackerOptions = {
  ownerWorktreeId: string
  executionHostId: ExecutionHostId
  agent: TuiAgent
  timeoutMs?: number
  onMatch: (item: SessionListItem) => void
  onTimeout: () => void
}

export type SessionLaunchTracker = {
  /** Publish the launcher result and resolve a newly materialized session, if available. */
  markLaunched: (tabId: string | null) => boolean
  stop: () => void
}

/**
 * Track a new agent launch until the session inventory has a stable identity.
 *
 * A launcher may return no tab id for structured or web-host launches, so the
 * inventory match must use the pre-launch key set plus the owner and agent.
 */
export function createSessionLaunchTracker(
  options: SessionLaunchTrackerOptions
): SessionLaunchTracker {
  const select = createSessionCollectionSelector()
  const before = new Set(select(useAppStore.getState()).items.map((item) => item.key))
  let tabId: string | null = null
  let launched = false
  let settled = false
  let timeout: ReturnType<typeof setTimeout> | undefined
  let unsubscribe = () => {}

  const stop = (): void => {
    unsubscribe()
    unsubscribe = () => {}
    if (timeout) {
      clearTimeout(timeout)
      timeout = undefined
    }
  }

  const inspect = (): boolean => {
    if (!launched || settled) {
      return false
    }
    const matches = select(useAppStore.getState()).items.filter(
      (item) =>
        !before.has(item.key) &&
        item.worktreeId === options.ownerWorktreeId &&
        item.executionHostId === options.executionHostId &&
        item.agent === options.agent &&
        (!tabId ||
          item.tabId === tabId ||
          item.terminalTabId === tabId ||
          item.unifiedTabId === tabId)
    )
    if (matches.length !== 1) {
      return false
    }
    settled = true
    stop()
    options.onMatch(matches[0])
    return true
  }

  unsubscribe = useAppStore.subscribe(inspect)

  return {
    markLaunched: (nextTabId) => {
      tabId = nextTabId
      launched = true
      if (inspect()) {
        return true
      }
      timeout = setTimeout(() => {
        if (settled) {
          return
        }
        settled = true
        stop()
        options.onTimeout()
      }, options.timeoutMs ?? 30_000)
      return false
    },
    stop
  }
}
