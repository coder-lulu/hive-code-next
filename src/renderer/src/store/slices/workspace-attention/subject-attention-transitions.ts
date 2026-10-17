import type { AppState } from '../../types'
import { movePaneKeyedRecord, removePaneKeys } from '../agent-status-pane-keyed-records'
import { omitRecordKeys } from '../worktrees/teardown/record-key-omission'
import { paneKeyTabId } from './workspace-live-markers'

// Marker removals that ride inside another slice's `set()`. Unchanged records keep their
// reference. Removal never touches the workspace flag.

type Markers = Pick<
  AppState,
  | 'unreadTerminalTabs'
  | 'unreadTerminalPanes'
  | 'unreadAgentCompletionPanes'
  | 'unreadAgentCompletionCountByPane'
>
type PaneMarkers = Pick<
  Markers,
  'unreadTerminalPanes' | 'unreadAgentCompletionPanes' | 'unreadAgentCompletionCountByPane'
>

function paneKeysOfTabs(
  record: Readonly<Record<string, unknown>>,
  tabIds: ReadonlySet<string>
): Set<string> {
  return new Set(
    Object.keys(record).filter((paneKey) => {
      const tabId = paneKeyTabId(paneKey)
      return tabId !== null && tabIds.has(tabId)
    })
  )
}

/** Closed, slept or purged tabs drop every layer. */
export function removeTabsAttention(
  s: Markers,
  tabIds: Iterable<string>,
  options?: { preserveCompletionCounts?: boolean }
): Markers {
  const removed = new Set(tabIds)
  return {
    unreadAgentCompletionCountByPane: options?.preserveCompletionCounts
      ? s.unreadAgentCompletionCountByPane
      : removePaneKeys(
          s.unreadAgentCompletionCountByPane ?? {},
          paneKeysOfTabs(s.unreadAgentCompletionCountByPane ?? {}, removed)
        ),
    unreadTerminalTabs: omitRecordKeys(s.unreadTerminalTabs, removed),
    unreadTerminalPanes: removePaneKeys(
      s.unreadTerminalPanes,
      paneKeysOfTabs(s.unreadTerminalPanes, removed)
    ),
    unreadAgentCompletionPanes: removePaneKeys(
      s.unreadAgentCompletionPanes,
      paneKeysOfTabs(s.unreadAgentCompletionPanes, removed)
    )
  }
}

/** Hibernated or retired panes drop their pane and completion layers; the tab marker stays. */
export function removePanesAttention(
  s: Markers,
  paneKeys: ReadonlySet<string>,
  options?: { preserveCompletionCounts?: boolean }
): PaneMarkers {
  return {
    unreadAgentCompletionCountByPane: options?.preserveCompletionCounts
      ? s.unreadAgentCompletionCountByPane
      : removePaneKeys(s.unreadAgentCompletionCountByPane ?? {}, paneKeys),
    unreadTerminalPanes: removePaneKeys(s.unreadTerminalPanes, paneKeys),
    unreadAgentCompletionPanes: removePaneKeys(s.unreadAgentCompletionPanes, paneKeys)
  }
}

/** A pane authority moving to a new key carries its pane and completion layers along. */
export function movePaneAttention(s: Markers, fromPaneKey: string, toPaneKey: string): PaneMarkers {
  return {
    unreadAgentCompletionCountByPane: movePaneKeyedRecord(
      s.unreadAgentCompletionCountByPane ?? {},
      fromPaneKey,
      toPaneKey,
      (count) => count + (s.unreadAgentCompletionCountByPane?.[toPaneKey] ?? 0)
    ),
    unreadTerminalPanes: movePaneKeyedRecord(s.unreadTerminalPanes, fromPaneKey, toPaneKey),
    unreadAgentCompletionPanes: movePaneKeyedRecord(
      s.unreadAgentCompletionPanes,
      fromPaneKey,
      toPaneKey
    )
  }
}
