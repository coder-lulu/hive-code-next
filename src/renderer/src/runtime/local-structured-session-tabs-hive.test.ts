// @vitest-environment happy-dom
import { afterEach, expect, it } from 'vitest'
import type {
  RuntimeMobileSessionTabsRemovedResult,
  RuntimeMobileSessionTabsResult
} from '../../../shared/runtime-types'
import type { Tab } from '../../../shared/tab-types'
import {
  applyLocalStructuredSessionTabSnapshots,
  resetLocalStructuredSessionVersionForTests
} from './local-structured-session-tabs-sync'
import {
  applyWebSessionTabsSnapshot,
  resetWebSessionTabsSnapshotFreshnessForTests,
  type WebSessionTabsSyncState
} from './web-session-tabs-sync'
const WORKTREE_ID = 'repo-1::worktree-1'
const TERMINAL_ID = 'terminal-1'
const STRUCTURED_ID = 'structured-agent-session-codex-1'
const PRIMARY_GROUP = 'primary-group'
const SECONDARY_GROUP = 'secondary-group'
afterEach(() => {
  resetLocalStructuredSessionVersionForTests()
  resetWebSessionTabsSnapshotFreshnessForTests()
})
function createSnapshot(): WebSessionTabsSyncState {
  const tabs: Tab[] = [
    {
      id: TERMINAL_ID,
      entityId: TERMINAL_ID,
      groupId: PRIMARY_GROUP,
      worktreeId: WORKTREE_ID,
      contentType: 'terminal',
      label: 'Terminal',
      customLabel: null,
      color: null,
      sortOrder: 0,
      createdAt: 1
    },
    {
      id: STRUCTURED_ID,
      entityId: 'codex-1',
      groupId: SECONDARY_GROUP,
      worktreeId: WORKTREE_ID,
      contentType: 'agent-session',
      agentSessionAgent: 'codex',
      label: 'Codex Chat',
      customLabel: null,
      color: null,
      sortOrder: 1,
      createdAt: 2
    }
  ]
  return {
    activeBrowserTabId: null,
    activeBrowserTabIdByWorktree: {},
    activeFileId: null,
    activeFileIdByWorktree: {},
    activeGroupIdByWorktree: { [WORKTREE_ID]: SECONDARY_GROUP },
    activeTabId: STRUCTURED_ID,
    activeTabIdByWorktree: { [WORKTREE_ID]: STRUCTURED_ID },
    activeTabType: 'agent-session',
    activeTabTypeByWorktree: { [WORKTREE_ID]: 'agent-session' },
    activeWorktreeId: WORKTREE_ID,
    agentStatusByPaneKey: {},
    agentStatusEpoch: 0,
    browserCertificateFailuresByPageId: {},
    browserPagesByWorkspace: {},
    browserTabsByWorktree: {},
    groupsByWorktree: {
      [WORKTREE_ID]: [
        {
          id: PRIMARY_GROUP,
          worktreeId: WORKTREE_ID,
          activeTabId: TERMINAL_ID,
          tabOrder: [TERMINAL_ID]
        },
        {
          id: SECONDARY_GROUP,
          worktreeId: WORKTREE_ID,
          activeTabId: STRUCTURED_ID,
          tabOrder: [STRUCTURED_ID]
        }
      ]
    },
    layoutByWorktree: {
      [WORKTREE_ID]: {
        type: 'split',
        direction: 'horizontal',
        first: { type: 'leaf', groupId: PRIMARY_GROUP },
        second: { type: 'leaf', groupId: SECONDARY_GROUP }
      }
    },
    openFiles: [],
    ptyIdsByTabId: { [TERMINAL_ID]: ['pty-1'] },
    remoteBrowserPageHandlesByPageId: {},
    tabBarOrderByWorktree: { [WORKTREE_ID]: [TERMINAL_ID, STRUCTURED_ID] },
    tabsByWorktree: {},
    terminalLayoutsByTabId: {},
    unifiedTabsByWorktree: { [WORKTREE_ID]: tabs },
    unreadTerminalTabs: {},
    sortEpoch: 0
  }
}

it('keeps Hive tabs through CLI inventory updates and retirement without retaining stale CLI tabs', () => {
  const state = createSnapshot()
  const hiveTab: Tab = {
    ...state.unifiedTabsByWorktree[WORKTREE_ID][1],
    id: 'hive-tab',
    entityId: 'hive-session',
    agentSessionAgent: 'hivecode'
  }
  state.unifiedTabsByWorktree[WORKTREE_ID].push(hiveTab)
  const next = applyLocalStructuredSessionTabSnapshots(state, [
    structuredInventory('epoch-hive', 1, 'codex-new')
  ])
  expect(next.unifiedTabsByWorktree[WORKTREE_ID]).toContainEqual(hiveTab)
  expect(next.unifiedTabsByWorktree[WORKTREE_ID].some((tab) => tab.entityId === 'codex-1')).toBe(
    false
  )
  const retraction: RuntimeMobileSessionTabsRemovedResult = {
    worktree: WORKTREE_ID,
    publicationEpoch: 'epoch-hive',
    snapshotVersion: 2,
    removed: true,
    activeGroupId: null,
    activeTabId: null,
    activeTabType: null,
    tabs: []
  }
  const retired = applyLocalStructuredSessionTabSnapshots(next, [retraction])
  expect(retired.unifiedTabsByWorktree[WORKTREE_ID]).toContainEqual(hiveTab)
  expect(
    retired.unifiedTabsByWorktree[WORKTREE_ID].some((tab) => tab.agentSessionAgent === 'codex')
  ).toBe(false)
})

it('does not keep absent Hive tabs in an authoritative remote snapshot', () => {
  const state = createSnapshot()
  state.unifiedTabsByWorktree[WORKTREE_ID][1].agentSessionAgent = 'hivecode'
  const patch = applyWebSessionTabsSnapshot(
    state,
    structuredInventory('remote', 1, 'codex-new'),
    'remote-host'
  )
  const next = { ...state, ...patch }
  expect(
    next.unifiedTabsByWorktree[WORKTREE_ID].some((tab) => tab.agentSessionAgent === 'hivecode')
  ).toBe(false)
})

function structuredInventory(
  publicationEpoch: string,
  snapshotVersion: number,
  sessionId: string
): RuntimeMobileSessionTabsResult {
  return {
    worktree: WORKTREE_ID,
    publicationEpoch,
    snapshotVersion,
    activeGroupId: SECONDARY_GROUP,
    activeTabId: `agent-session:${sessionId}`,
    activeTabType: 'agent-session',
    tabGroups: [
      {
        id: SECONDARY_GROUP,
        activeTabId: `agent-session:${sessionId}`,
        tabOrder: [`agent-session:${sessionId}`]
      }
    ],
    tabs: [
      {
        type: 'agent-session',
        id: `agent-session:${sessionId}`,
        title: 'Codex Chat',
        sessionId,
        agent: 'codex',
        isActive: true
      }
    ]
  }
}
