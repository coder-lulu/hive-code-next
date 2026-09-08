import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'

import { migrationUnsupportedToAgentStatusEntry } from '@/lib/migration-unsupported-agent-entry'
import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import type { AgentStatusEntry } from '../../../../shared/agent-status-types'

import { freshActivityLiveAgentState, isHistoricalActivityState } from './activity-event-state'

type ActivityUnreadCountSource = Pick<
  AppState,
  | 'acknowledgedAgentsByPaneKey'
  | 'agentStatusByPaneKey'
  | 'migrationUnsupportedByPtyId'
  | 'retainedAgentsByPaneKey'
> & {
  worktreesByRepo?: AppState['worktreesByRepo']
  activityClearedAtByPaneKey?: Record<string, number>
}

type ActivityUnreadCountMode = 'agent-events' | 'sidebar-badge'

const EMPTY_WORKTREES_BY_REPO: AppState['worktreesByRepo'] = {}
const EMPTY_MIGRATION_UNSUPPORTED: AppState['migrationUnsupportedByPtyId'] = {}
const EMPTY_RETAINED_AGENTS: AppState['retainedAgentsByPaneKey'] = {}
const EMPTY_ACKNOWLEDGED_AGENTS: AppState['acknowledgedAgentsByPaneKey'] = {}

const DISABLED_ACTIVITY_UNREAD_INPUTS = {
  agentStatusEpoch: 0,
  worktreesByRepo: EMPTY_WORKTREES_BY_REPO,
  migrationUnsupportedByPtyId: EMPTY_MIGRATION_UNSUPPORTED,
  retainedAgentsByPaneKey: EMPTY_RETAINED_AGENTS,
  acknowledgedAgentsByPaneKey: EMPTY_ACKNOWLEDGED_AGENTS,
  activityClearedAtByPaneKey: {} as Record<string, number>
}

export function countActivityUnread(
  source: ActivityUnreadCountSource,
  modeOrNow: ActivityUnreadCountMode | number = 'agent-events',
  now = Date.now()
): number {
  const mode = typeof modeOrNow === 'number' ? 'agent-events' : modeOrNow
  if (typeof modeOrNow === 'number') {
    now = modeOrNow
  }
  let count = 0
  const seenPaneKeys = new Set<string>()

  if (mode === 'sidebar-badge') {
    for (const worktrees of Object.values(source.worktreesByRepo ?? {})) {
      for (const worktree of worktrees) {
        if (worktree.createdAt && worktree.isUnread) {
          count += 1
        }
      }
    }
  }

  const countEntry = (entry: AgentStatusEntry, ackAt: number, live = false): void => {
    if (seenPaneKeys.has(entry.paneKey)) {
      return
    }
    seenPaneKeys.add(entry.paneKey)
    ackAt = Math.max(ackAt, source.activityClearedAtByPaneKey?.[entry.paneKey] ?? 0)
    if (mode === 'agent-events') {
      // Why: Activity feed surfaces historical done/blocked/waiting events
      // from stateHistory, so the titlebar badge must mirror that event count.
      for (const history of entry.stateHistory) {
        if (isHistoricalActivityState(history.state) && ackAt < history.startedAt) {
          count += 1
        }
      }
    }
    // Why: a session-boundary done is an idle connect (STA-3386), not an event to read.
    // History never contains a boundary, but it DOES keep the real completion a boundary
    // displaced (the slice pushes it on done→done), so sidebar-badge mode — which skips the
    // history loop above — must still count that displaced completion or the badge silently
    // drops an unacknowledged finish the moment its session is resumed.
    // Why 'working' only: a monitoring turn surfaces through the live snapshot, never as an
    // unread event, so counting it here would light the badge with no unread row to clear.
    if (
      (isHistoricalActivityState(entry.state) ||
        (mode === 'agent-events' &&
          live &&
          freshActivityLiveAgentState(entry, now) === 'working')) &&
      entry.sessionBoundary !== true &&
      ackAt < entry.stateStartedAt
    ) {
      count += 1
    } else if (mode === 'sidebar-badge' && entry.state === 'done' && entry.sessionBoundary) {
      const displaced = entry.stateHistory.at(-1)
      if (displaced && isHistoricalActivityState(displaced.state) && ackAt < displaced.startedAt) {
        count += 1
      }
    }
  }

  for (const [paneKey, entry] of Object.entries(source.agentStatusByPaneKey)) {
    countEntry(entry, source.acknowledgedAgentsByPaneKey[paneKey] ?? 0, true)
  }
  for (const [paneKey, retained] of Object.entries(source.retainedAgentsByPaneKey)) {
    if (mode === 'sidebar-badge' && retained.entry.state !== 'done') {
      continue
    }
    countEntry(retained.entry, source.acknowledgedAgentsByPaneKey[paneKey] ?? 0)
  }
  for (const unsupported of Object.values(source.migrationUnsupportedByPtyId)) {
    const entry = migrationUnsupportedToAgentStatusEntry(unsupported)
    if (entry) {
      countEntry(entry, source.acknowledgedAgentsByPaneKey[entry.paneKey] ?? 0)
    }
  }

  return count
}

export function useActivityUnreadCount(
  enabled = true,
  mode: ActivityUnreadCountMode = 'agent-events'
): number {
  const {
    agentStatusEpoch,
    worktreesByRepo,
    migrationUnsupportedByPtyId,
    retainedAgentsByPaneKey,
    acknowledgedAgentsByPaneKey,
    activityClearedAtByPaneKey
  } = useAppStore(
    useShallow((state) => {
      if (!enabled) {
        return DISABLED_ACTIVITY_UNREAD_INPUTS
      }
      return {
        // Freshness transitions change the Activity count even without a new historical event.
        agentStatusEpoch: state.agentStatusEpoch,
        worktreesByRepo: state.worktreesByRepo,
        migrationUnsupportedByPtyId: state.migrationUnsupportedByPtyId,
        retainedAgentsByPaneKey: state.retainedAgentsByPaneKey,
        acknowledgedAgentsByPaneKey: state.acknowledgedAgentsByPaneKey,
        activityClearedAtByPaneKey: state.activityClearedAtByPaneKey
      }
    })
  )

  return useMemo(() => {
    if (!enabled) {
      return 0
    }
    void agentStatusEpoch
    return countActivityUnread(
      {
        agentStatusByPaneKey: useAppStore.getState().agentStatusByPaneKey,
        migrationUnsupportedByPtyId,
        retainedAgentsByPaneKey,
        worktreesByRepo,
        acknowledgedAgentsByPaneKey,
        activityClearedAtByPaneKey
      },
      mode
    )
  }, [
    acknowledgedAgentsByPaneKey,
    activityClearedAtByPaneKey,
    enabled,
    migrationUnsupportedByPtyId,
    mode,
    retainedAgentsByPaneKey,
    agentStatusEpoch,
    worktreesByRepo
  ])
}
