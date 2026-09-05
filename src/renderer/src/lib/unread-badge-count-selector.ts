import { sameBucketRecords } from './bucket-record-equality'
import {
  type UnreadBadgeCountSources,
  type UnreadBadgeTab,
  type UnreadBadgeWorktree,
  type UnreadBadgeUnifiedTab,
  getUnreadBadgeCount
} from './unread-badge-count'

const EMPTY_BUCKETS = Object.freeze({})

function sameBadgeWorktree(previous: UnreadBadgeWorktree, next: UnreadBadgeWorktree): boolean {
  return previous.id === next.id && previous.isUnread === next.isUnread
}

function sameBadgeTab(previous: UnreadBadgeTab, next: UnreadBadgeTab): boolean {
  return previous.id === next.id
}

function sameBadgeUnifiedTab(
  previous: UnreadBadgeUnifiedTab,
  next: UnreadBadgeUnifiedTab
): boolean {
  return (
    previous.id === next.id &&
    previous.entityId === next.entityId &&
    previous.worktreeId === next.worktreeId
  )
}

/**
 * Why: the App root holds this subscription for a single integer. Returning the raw maps re-rendered
 * the whole shell on every agent title frame; selecting the count instead means the subscription
 * only notifies when the badge value can actually have moved.
 *
 * Why chaining against the immediately preceding state is enough: equality over the count's read set
 * — worktree unread state, terminal/unified tab identity, and unread/count map identities — is transitive, so a run of
 * unchanged states is equivalent to comparing against the state that produced the cached count.
 */
export function createUnreadBadgeCountSelector(): (state: UnreadBadgeCountSources) => number {
  let previousWorktreesByRepo: UnreadBadgeCountSources['worktreesByRepo'] = EMPTY_BUCKETS
  let previousTabsByWorktree: UnreadBadgeCountSources['tabsByWorktree'] = EMPTY_BUCKETS
  let previousUnreadTerminalTabs: UnreadBadgeCountSources['unreadTerminalTabs'] | undefined
  let previousUnifiedTabsByWorktree: NonNullable<UnreadBadgeCountSources['unifiedTabsByWorktree']> =
    EMPTY_BUCKETS
  let previousCompletionCounts: UnreadBadgeCountSources['unreadAgentCompletionCountByPane']
  let unreadCount = 0
  let counted = false

  return (state) => {
    const unifiedTabsByWorktree = state.unifiedTabsByWorktree ?? EMPTY_BUCKETS
    const unchanged =
      counted &&
      previousUnreadTerminalTabs === state.unreadTerminalTabs &&
      sameBucketRecords(previousWorktreesByRepo, state.worktreesByRepo, sameBadgeWorktree) &&
      sameBucketRecords(previousTabsByWorktree, state.tabsByWorktree, sameBadgeTab) &&
      previousCompletionCounts === state.unreadAgentCompletionCountByPane &&
      sameBucketRecords(previousUnifiedTabsByWorktree, unifiedTabsByWorktree, sameBadgeUnifiedTab)
    if (!unchanged) {
      unreadCount = getUnreadBadgeCount(state)
      previousUnreadTerminalTabs = state.unreadTerminalTabs
      counted = true
    }
    previousWorktreesByRepo = state.worktreesByRepo
    previousTabsByWorktree = state.tabsByWorktree
    previousUnifiedTabsByWorktree = unifiedTabsByWorktree
    previousCompletionCounts = state.unreadAgentCompletionCountByPane
    return unreadCount
  }
}
