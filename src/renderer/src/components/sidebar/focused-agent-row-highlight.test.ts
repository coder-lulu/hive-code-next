import { describe, expect, it } from 'vitest'
import type {
  AgentStatusEntry,
  MigrationUnsupportedPtyEntry
} from '../../../../shared/agent-status-types'
import { makePaneKey } from '../../../../shared/stable-pane-id'
import { structuredAgentSessionPaneKey } from '../../../../shared/structured-agent-session-projection'
import type { AppState } from '@/store/types'
import type { TerminalTab } from '../../../../shared/terminal-tab-types'
import {
  getFocusedAgentPaneKeyForWorktree,
  type FocusedAgentRowHighlightState
} from './focused-agent-row-highlight'

const WORKTREE_ID = 'repo-1::/worktree'
const OTHER_WORKTREE_ID = 'repo-1::/other'
const TAB_ID = 'tab-1'
const OTHER_TAB_ID = 'tab-2'
const LEAF_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_LEAF_ID = '22222222-2222-4222-8222-222222222222'
const PANE_KEY = makePaneKey(TAB_ID, LEAF_ID)
const OTHER_PANE_KEY = makePaneKey(TAB_ID, OTHER_LEAF_ID)
type TestState = FocusedAgentRowHighlightState &
  Pick<AppState, 'agentStatusByPaneKey' | 'retainedAgentsByPaneKey' | 'migrationUnsupportedByPtyId'>

function makeTab(id: string, worktreeId = WORKTREE_ID): TerminalTab {
  return {
    id,
    worktreeId,
    ptyId: 'pty-1',
    title: 'bash',
    customTitle: null,
    color: null,
    sortOrder: 0,
    createdAt: 0
  }
}

function makeAgentStatusEntry(paneKey: string, updatedAt = 1_000): AgentStatusEntry {
  return {
    paneKey,
    state: 'working',
    prompt: '',
    updatedAt,
    stateStartedAt: updatedAt,
    stateHistory: []
  }
}

function makeUnsupportedEntry(paneKey: string): MigrationUnsupportedPtyEntry {
  return {
    ptyId: 'pty-unsupported',
    worktreeId: WORKTREE_ID,
    tabId: TAB_ID,
    leafId: LEAF_ID,
    paneKey,
    reason: 'legacy-numeric-pane-key',
    source: 'local',
    updatedAt: 1_000
  }
}

function makeState(overrides: Partial<TestState> = {}): TestState {
  return {
    activeView: 'terminal',
    activeGroupIdByWorktree: { [WORKTREE_ID]: 'group-1' },
    groupsByWorktree: {
      [WORKTREE_ID]: [
        { id: 'group-1', worktreeId: WORKTREE_ID, activeTabId: 'chat-tab', tabOrder: ['chat-tab'] }
      ]
    },
    unifiedTabsByWorktree: {
      [WORKTREE_ID]: [
        {
          id: 'chat-tab',
          entityId: 'session-1',
          groupId: 'group-1',
          worktreeId: WORKTREE_ID,
          contentType: 'agent-session',
          label: 'Conversation',
          customLabel: null,
          color: null,
          sortOrder: 0,
          createdAt: 0
        }
      ]
    },
    activeWorktreeId: WORKTREE_ID,
    activeTabType: 'terminal',
    activeTabId: TAB_ID,
    tabsByWorktree: {
      [WORKTREE_ID]: [makeTab(TAB_ID)],
      [OTHER_WORKTREE_ID]: [makeTab(OTHER_TAB_ID, OTHER_WORKTREE_ID)]
    },
    terminalLayoutsByTabId: {
      [TAB_ID]: {
        root: { type: 'leaf', leafId: LEAF_ID },
        activeLeafId: LEAF_ID,
        expandedLeafId: null
      }
    },
    agentStatusByPaneKey: {},
    retainedAgentsByPaneKey: {},
    migrationUnsupportedByPtyId: {},
    ...overrides
  }
}

describe('getFocusedAgentPaneKeyForWorktree', () => {
  it('highlights a title-derived terminal session before hook status arrives', () => {
    const state = makeState({
      tabsByWorktree: { [WORKTREE_ID]: [{ ...makeTab(TAB_ID), title: 'Codex' }] }
    })
    expect(getFocusedAgentPaneKeyForWorktree(state, WORKTREE_ID)).toBe(PANE_KEY)
  })

  it('highlights the structured session in the active group despite a stale terminal id', () => {
    const state = makeState({ activeTabType: 'agent-session' })
    expect(getFocusedAgentPaneKeyForWorktree(state, WORKTREE_ID)).toBe(
      structuredAgentSessionPaneKey('chat-tab', 'session-1')
    )
  })

  it('moves the highlight to the newly selected structured conversation', () => {
    const state = makeState({ activeTabType: 'agent-session' })
    state.unifiedTabsByWorktree[WORKTREE_ID].push({
      ...state.unifiedTabsByWorktree[WORKTREE_ID][0],
      id: 'second-chat',
      entityId: 'session-2'
    })
    const group = state.groupsByWorktree[WORKTREE_ID][0]
    group.tabOrder.push('second-chat')
    expect(getFocusedAgentPaneKeyForWorktree(state, WORKTREE_ID)).toBe(
      structuredAgentSessionPaneKey('chat-tab', 'session-1')
    )
    group.activeTabId = 'second-chat'
    expect(getFocusedAgentPaneKeyForWorktree(state, WORKTREE_ID)).toBe(
      structuredAgentSessionPaneKey('second-chat', 'session-2')
    )
  })

  it('does not highlight a different workspace', () => {
    expect(getFocusedAgentPaneKeyForWorktree(makeState(), OTHER_WORKTREE_ID)).toBeNull()
    expect(
      getFocusedAgentPaneKeyForWorktree(
        makeState({ activeTabType: 'agent-session' }),
        OTHER_WORKTREE_ID
      )
    ).toBeNull()
  })

  it('highlights a remote folder session only within its active host bucket', () => {
    const state = makeState({ activeTabType: 'agent-session' })
    const bucketKey = 'runtime:env|folder:one'
    state.activeWorktreeId = bucketKey
    state.activeGroupIdByWorktree[bucketKey] = 'group-1'
    state.groupsByWorktree[bucketKey] = [
      { ...state.groupsByWorktree[WORKTREE_ID][0], worktreeId: 'folder:one' }
    ]
    state.unifiedTabsByWorktree[bucketKey] = [
      { ...state.unifiedTabsByWorktree[WORKTREE_ID][0], worktreeId: 'folder:one' }
    ]
    expect(getFocusedAgentPaneKeyForWorktree(state, bucketKey)).toBe(
      structuredAgentSessionPaneKey('chat-tab', 'session-1')
    )
    expect(getFocusedAgentPaneKeyForWorktree(state, 'runtime:other|folder:one')).toBeNull()
    expect(getFocusedAgentPaneKeyForWorktree(state, 'folder:one')).toBeNull()
  })

  it('does not highlight stale sessions outside the workspace view', () => {
    expect(
      getFocusedAgentPaneKeyForWorktree(makeState({ activeView: 'settings' }), WORKTREE_ID)
    ).toBeNull()
  })

  it('does not select a structured session from a missing or different group', () => {
    const state = makeState({
      activeTabType: 'agent-session',
      activeGroupIdByWorktree: { [WORKTREE_ID]: 'missing' }
    })
    expect(getFocusedAgentPaneKeyForWorktree(state, WORKTREE_ID)).toBeNull()
    state.activeGroupIdByWorktree[WORKTREE_ID] = 'group-1'
    state.unifiedTabsByWorktree[WORKTREE_ID][0].groupId = 'group-2'
    expect(getFocusedAgentPaneKeyForWorktree(state, WORKTREE_ID)).toBeNull()
  })

  it('rejects a structured tab with a different workspace or content type', () => {
    const state = makeState({ activeTabType: 'agent-session' })
    state.unifiedTabsByWorktree[WORKTREE_ID][0].worktreeId = OTHER_WORKTREE_ID
    expect(getFocusedAgentPaneKeyForWorktree(state, WORKTREE_ID)).toBeNull()
    state.unifiedTabsByWorktree[WORKTREE_ID][0].worktreeId = WORKTREE_ID
    state.unifiedTabsByWorktree[WORKTREE_ID][0].contentType = 'editor'
    expect(getFocusedAgentPaneKeyForWorktree(state, WORKTREE_ID)).toBeNull()
  })

  it('requires a terminal belonging to the workspace and a stable leaf identity', () => {
    expect(
      getFocusedAgentPaneKeyForWorktree(makeState({ activeTabId: OTHER_TAB_ID }), WORKTREE_ID)
    ).toBeNull()
    const state = makeState()
    state.terminalLayoutsByTabId[TAB_ID].activeLeafId = '1'
    expect(getFocusedAgentPaneKeyForWorktree(state, WORKTREE_ID)).toBeNull()
  })

  it('returns the focused pane key when that pane has a live agent status', () => {
    const state = makeState({
      agentStatusByPaneKey: {
        [PANE_KEY]: makeAgentStatusEntry(PANE_KEY)
      }
    })

    expect(getFocusedAgentPaneKeyForWorktree(state, WORKTREE_ID)).toBe(PANE_KEY)
  })

  it('highlights a focused row whose status has decayed past freshness', () => {
    // Why: the inline card keeps decayed agents visible; clicking one must still
    // color the row even though its status is no longer fresh.
    const state = makeState({
      agentStatusByPaneKey: {
        [PANE_KEY]: makeAgentStatusEntry(PANE_KEY, 1)
      }
    })

    expect(getFocusedAgentPaneKeyForWorktree(state, WORKTREE_ID)).toBe(PANE_KEY)
  })

  it('does not return another split pane in the same terminal tab', () => {
    const state = makeState({
      agentStatusByPaneKey: {
        [OTHER_PANE_KEY]: makeAgentStatusEntry(OTHER_PANE_KEY)
      }
    })

    expect(getFocusedAgentPaneKeyForWorktree(state, WORKTREE_ID)).toBe(PANE_KEY)
    expect(getFocusedAgentPaneKeyForWorktree(state, WORKTREE_ID)).not.toBe(OTHER_PANE_KEY)
  })

  it('does not highlight while another surface type is active', () => {
    const state = makeState({
      activeTabType: 'editor',
      agentStatusByPaneKey: {
        [PANE_KEY]: makeAgentStatusEntry(PANE_KEY)
      }
    })

    expect(getFocusedAgentPaneKeyForWorktree(state, WORKTREE_ID)).toBeNull()
  })

  it('returns retained agent row pane keys for the focused pane', () => {
    const entry = makeAgentStatusEntry(PANE_KEY)
    const state = makeState({
      retainedAgentsByPaneKey: {
        [PANE_KEY]: {
          entry,
          tab: makeTab(TAB_ID),
          worktreeId: WORKTREE_ID,
          agentType: 'codex',
          startedAt: 1_000
        }
      }
    })

    expect(getFocusedAgentPaneKeyForWorktree(state, WORKTREE_ID)).toBe(PANE_KEY)
  })

  it('returns migration-unsupported agent row pane keys for the focused pane', () => {
    const state = makeState({
      migrationUnsupportedByPtyId: {
        'pty-unsupported': makeUnsupportedEntry(PANE_KEY)
      }
    })

    expect(getFocusedAgentPaneKeyForWorktree(state, WORKTREE_ID)).toBe(PANE_KEY)
  })
})
