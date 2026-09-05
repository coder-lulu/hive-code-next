import { describe, expect, it } from 'vitest'
import type { TerminalTab } from '../../../shared/terminal-tab-types'
import type { Tab } from '../../../shared/tab-types'
import type { Worktree } from '../../../shared/worktree/types'
import { getUnreadBadgeCount, type UnreadBadgeCountSources } from './unread-badge-count'
import { createUnreadBadgeCountSelector } from './unread-badge-count-selector'

function worktree(id: string, isUnread: boolean): Worktree {
  return { id, isUnread } as Worktree
}

function tab(id: string): TerminalTab {
  return { id } as TerminalTab
}

function unifiedTab(id: string, worktreeId: string, entityId = id): Tab {
  return { id, entityId, worktreeId } as Tab
}

describe('getUnreadBadgeCount', () => {
  it('counts unread worktrees', () => {
    expect(
      getUnreadBadgeCount({
        worktreesByRepo: { repo: [worktree('wt-1', true), worktree('wt-2', false)] },
        tabsByWorktree: {},
        unreadTerminalTabs: {}
      })
    ).toBe(1)
  })

  it('dedupes unread terminal tabs against their worktree', () => {
    expect(
      getUnreadBadgeCount({
        worktreesByRepo: { repo: [worktree('wt-1', true)] },
        tabsByWorktree: { 'wt-1': [tab('tab-1'), tab('tab-2')] },
        unreadTerminalTabs: { 'tab-1': true, 'tab-2': true }
      })
    ).toBe(1)
  })

  it('counts tab-only unread activity by owning worktree', () => {
    expect(
      getUnreadBadgeCount({
        worktreesByRepo: { repo: [worktree('wt-1', false), worktree('wt-2', false)] },
        tabsByWorktree: { 'wt-1': [tab('tab-1')], 'wt-2': [tab('tab-2')] },
        unreadTerminalTabs: { 'tab-1': true, 'tab-2': true }
      })
    ).toBe(2)
  })

  it('uses each unseen task completion when a pane has multiple completions', () => {
    expect(
      getUnreadBadgeCount({
        worktreesByRepo: { repo: [worktree('wt-1', true)] },
        tabsByWorktree: { 'wt-1': [tab('tab-1')] },
        unreadTerminalTabs: { 'tab-1': true },
        unreadAgentCompletionCountByPane: {
          'tab-1:leaf-1': 2,
          'tab-2:leaf-1': 1
        }
      })
    ).toBe(3)
  })

  it('keeps completion attention when no legacy tab unread marker exists', () => {
    expect(
      getUnreadBadgeCount({
        worktreesByRepo: { repo: [worktree('wt-1', false)] },
        tabsByWorktree: { 'wt-1': [tab('tab-1')] },
        unreadTerminalTabs: {},
        unreadAgentCompletionCountByPane: { 'tab-1:leaf-1': 2 }
      })
    ).toBe(2)
  })

  it('adds task completions to unrelated legacy unread attention', () => {
    expect(
      getUnreadBadgeCount({
        worktreesByRepo: {
          repo: [worktree('wt-1', true), worktree('wt-2', true), worktree('wt-3', false)]
        },
        tabsByWorktree: { 'wt-3': [tab('tab-3')] },
        unreadTerminalTabs: {},
        unreadAgentCompletionCountByPane: { 'tab-3:leaf-1': 1 }
      })
    ).toBe(3)
  })

  it('does not double count legacy attention owned by a completed task', () => {
    expect(
      getUnreadBadgeCount({
        worktreesByRepo: {
          repo: [worktree('wt-1', true), worktree('wt-2', true)]
        },
        tabsByWorktree: { 'wt-1': [tab('tab-1')] },
        unreadTerminalTabs: { 'tab-1': true },
        unreadAgentCompletionCountByPane: { 'tab-1:leaf-1': 2 }
      })
    ).toBe(3)
  })

  it('does not double count a structured-session completion against its worktree', () => {
    expect(
      getUnreadBadgeCount({
        worktreesByRepo: { repo: [worktree('wt-1', true)] },
        tabsByWorktree: {},
        unifiedTabsByWorktree: {
          'wt-1': [unifiedTab('structured-tab', 'wt-1', 'provider-session')]
        },
        unreadTerminalTabs: {},
        unreadAgentCompletionCountByPane: { 'structured-tab:leaf-1': 2 }
      })
    ).toBe(2)
  })
})

describe('Dock badge completion updates', () => {
  it('updates completion counts and dedupes a structured tab when its inventory arrives', () => {
    const select = createUnreadBadgeCountSelector()
    const state: UnreadBadgeCountSources = {
      worktreesByRepo: { repo: [worktree('wt-1', true)] },
      tabsByWorktree: {},
      unreadTerminalTabs: {},
      unreadAgentCompletionCountByPane: {}
    }
    expect(select(state)).toBe(1)

    const completed = { ...state, unreadAgentCompletionCountByPane: { 'session-1:leaf-1': 2 } }
    expect(select(completed)).toBe(3)
    expect(
      select({
        ...completed,
        unifiedTabsByWorktree: { 'wt-1': [unifiedTab('ui-session-1', 'wt-1', 'session-1')] }
      })
    ).toBe(2)
  })
})
