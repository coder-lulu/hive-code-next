import { describe, expect, it } from 'vitest'
import { makeTab, makeUnifiedTab } from '@/store/slices/store-session-test-harness'
import { makeWorktree, TEST_REPO } from '@/store/slices/worktrees-slice-test-fixtures'
import { getUnreadBadgeCount, type UnreadBadgeCountSources } from './unread-badge-count'

function sources(overrides: Partial<UnreadBadgeCountSources> = {}): UnreadBadgeCountSources {
  return {
    worktreesByRepo: { repo1: [makeWorktree({ id: 'wt', repoId: TEST_REPO.id, isUnread: true })] },
    folderWorkspaces: [],
    projectGroups: [],
    repoMap: new Map([[TEST_REPO.id, TEST_REPO]]),
    visibleHostIds: null,
    defaultHostId: 'local',
    hiddenOtherDevicePairings: null,
    tabsByWorktree: { wt: [makeTab({ id: 'tab', worktreeId: 'wt' })] },
    unreadTerminalTabs: { tab: true },
    unreadAgentCompletionCountByPane: { 'tab:leaf': 2 },
    ...overrides
  }
}

describe('task completion Dock badge', () => {
  it('counts each completion once instead of the owning workspace flag', () => {
    expect(getUnreadBadgeCount(sources())).toBe(2)
  })

  it('resolves structured completion identity through both tab and provider session ids', () => {
    expect(
      getUnreadBadgeCount(
        sources({
          tabsByWorktree: {},
          unifiedTabsByWorktree: {
            wt: [
              makeUnifiedTab({
                id: 'chat',
                entityId: 'session',
                worktreeId: 'wt',
                groupId: 'group'
              })
            ]
          },
          unreadAgentCompletionCountByPane: { 'session:leaf': 2 }
        })
      )
    ).toBe(2)
  })

  it('keeps completion counts awaiting tab inventory without inventing workspace flags', () => {
    expect(getUnreadBadgeCount(sources({ tabsByWorktree: {}, worktreesByRepo: {} }))).toBe(2)
  })

  it('excludes archived task owners from the badge', () => {
    expect(
      getUnreadBadgeCount(
        sources({
          worktreesByRepo: {
            repo1: [makeWorktree({ id: 'wt', repoId: TEST_REPO.id, isArchived: true })]
          }
        })
      )
    ).toBe(0)
  })
})
