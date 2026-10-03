import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as AgentStatusModule from '@/lib/agent-status'
import { createTabsSliceMockApi } from './tabs-slice-test-harness'
import { createTestStore, makeTab, makeWorktree, TEST_REPO } from './store-test-helpers'
import { getDefaultWorkspaceSession } from '../../../../shared/constants'
import { collectFolderWorkspaceKeysFromSession } from '../../lib/workspace-session-hydration-keys'
import type { WorkspaceSessionState } from '../../../../shared/workspace-session-state-types'

vi.mock('sonner', () => ({ toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/agent-status', async (importOriginal) => {
  const actual = await importOriginal<typeof AgentStatusModule>()
  return {
    ...actual,
    detectAgentStatusFromTitle: vi.fn().mockReturnValue(null)
  }
})

createTabsSliceMockApi()

const WT = 'repo1::/tmp/feature'

describe('terminal PTY ownership reconciliation', () => {
  let store: ReturnType<typeof createTestStore>

  beforeEach(() => {
    store = createTestStore()
  })

  it('keeps one owner when host and web mirror rows share a PTY', () => {
    const hostTabId = 'host-terminal-1'
    const mirrorTabId = 'web-terminal-host-terminal-1'

    store.setState({
      tabsByWorktree: {
        [WT]: [
          {
            id: hostTabId,
            ptyId: 'shared-pty',
            worktreeId: WT,
            title: 'Terminal 1',
            customTitle: null,
            color: null,
            sortOrder: 0,
            createdAt: 1
          },
          {
            id: mirrorTabId,
            ptyId: 'shared-pty',
            worktreeId: WT,
            title: 'Terminal 1 mirror',
            customTitle: null,
            color: null,
            sortOrder: 1,
            createdAt: 2
          }
        ]
      },
      // The mirror has the live attachment; the host row only has its
      // persisted wake hint. Reconciliation must retain the live owner.
      ptyIdsByTabId: { [hostTabId]: [], [mirrorTabId]: ['shared-pty'] },
      pendingReconnectPtyIdByTabId: { [hostTabId]: 'shared-pty' },
      lastKnownRelayPtyIdByTabId: { [hostTabId]: 'shared-pty' },
      deferredSshSessionIdsByTabId: { [hostTabId]: 'shared-pty' },
      unverifiedPtyLossTabIds: { [hostTabId]: true },
      pendingReconnectTabByWorktree: { [WT]: [hostTabId, mirrorTabId] },
      directSshPaneRetryByTabId: { [hostTabId]: {} as never },
      directSshLivePtyBindingByTabId: { [hostTabId]: {} as never },
      directSshPaneRetryHistoryByTabId: { [hostTabId]: {} as never },
      sleepingAgentSessionsByPaneKey: {
        [`${hostTabId}:leaf-1`]: {} as never
      },
      unreadTerminalTabs: { [hostTabId]: true },
      unreadTerminalPanes: { [`${hostTabId}:leaf-1`]: true },
      unreadAgentCompletionPanes: { [`${hostTabId}:leaf-1`]: true },
      lastTerminalInputAtByPaneKey: { [`${hostTabId}:leaf-1`]: 123 },
      unifiedTabsByWorktree: { [WT]: [] },
      groupsByWorktree: { [WT]: [] },
      activeGroupIdByWorktree: {}
    })

    const result = store.getState().reconcileWorktreeTabModel(WT)
    const state = store.getState()

    expect(result.renderableTabCount).toBe(1)
    expect(state.tabsByWorktree[WT]?.map((tab) => tab.id)).toEqual([mirrorTabId])
    expect(state.unifiedTabsByWorktree[WT]?.map((tab) => tab.entityId)).toEqual([mirrorTabId])
    expect(state.ptyIdsByTabId[hostTabId]).toBeUndefined()
    expect(state.ptyIdsByTabId[mirrorTabId]).toEqual(['shared-pty'])
    expect(state.pendingReconnectPtyIdByTabId[hostTabId]).toBeUndefined()
    expect(state.lastKnownRelayPtyIdByTabId[hostTabId]).toBeUndefined()
    expect(state.deferredSshSessionIdsByTabId[hostTabId]).toBeUndefined()
    expect(state.unverifiedPtyLossTabIds[hostTabId]).toBeUndefined()
    expect(state.pendingReconnectTabByWorktree[WT]).toEqual([mirrorTabId])
    expect(state.directSshPaneRetryByTabId[hostTabId]).toBeUndefined()
    expect(state.directSshLivePtyBindingByTabId[hostTabId]).toBeUndefined()
    expect(state.directSshPaneRetryHistoryByTabId[hostTabId]).toBeUndefined()
    expect(state.sleepingAgentSessionsByPaneKey[`${hostTabId}:leaf-1`]).toBeUndefined()
    expect(state.unreadTerminalTabs[hostTabId]).toBeUndefined()
    expect(state.unreadTerminalPanes[`${hostTabId}:leaf-1`]).toBeUndefined()
    expect(state.unreadAgentCompletionPanes[`${hostTabId}:leaf-1`]).toBeUndefined()
    expect(state.lastTerminalInputAtByPaneKey[`${hostTabId}:leaf-1`]).toBeUndefined()
  })

  it('dedupes shared PTY owners that were already promoted into the unified model', () => {
    const groupId = 'g-terminal'
    const hostTabId = 'host-terminal-1'
    const mirrorTabId = 'web-terminal-host-terminal-1'
    const makeRuntimeTab = (id: string, sortOrder: number) => ({
      id,
      ptyId: 'shared-pty',
      worktreeId: WT,
      title: id,
      customTitle: null,
      color: null,
      sortOrder,
      createdAt: sortOrder + 1
    })
    const makeUnifiedTab = (id: string, sortOrder: number) => ({
      id,
      entityId: id,
      groupId,
      worktreeId: WT,
      contentType: 'terminal' as const,
      label: id,
      customLabel: null,
      color: null,
      sortOrder,
      createdAt: sortOrder + 1
    })

    store.setState({
      tabsByWorktree: {
        [WT]: [makeRuntimeTab(hostTabId, 0), makeRuntimeTab(mirrorTabId, 1)]
      },
      ptyIdsByTabId: { [hostTabId]: [], [mirrorTabId]: ['shared-pty'] },
      unifiedTabsByWorktree: {
        [WT]: [makeUnifiedTab(hostTabId, 0), makeUnifiedTab(mirrorTabId, 1)]
      },
      groupsByWorktree: {
        [WT]: [
          {
            id: groupId,
            worktreeId: WT,
            activeTabId: hostTabId,
            tabOrder: [hostTabId, mirrorTabId]
          }
        ]
      },
      activeGroupIdByWorktree: { [WT]: groupId }
    })

    const result = store.getState().reconcileWorktreeTabModel(WT)
    const state = store.getState()

    expect(result.renderableTabCount).toBe(1)
    expect(state.tabsByWorktree[WT]?.map((tab) => tab.id)).toEqual([mirrorTabId])
    expect(state.unifiedTabsByWorktree[WT]?.map((tab) => tab.entityId)).toEqual([mirrorTabId])
    expect(state.groupsByWorktree[WT]?.[0]).toMatchObject({
      activeTabId: mirrorTabId,
      tabOrder: [mirrorTabId]
    })
  })

  it('dedupes an exact host/web mirror pair after dead PTY evidence was sanitized', () => {
    const groupId = 'g-terminal'
    const hostTabId = 'host-terminal-1'
    const mirrorTabId = 'web-terminal-host-terminal-1'
    const makeRuntimeTab = (id: string, sortOrder: number) => ({
      id,
      ptyId: null,
      worktreeId: WT,
      title: id,
      customTitle: null,
      color: null,
      sortOrder,
      createdAt: sortOrder + 1
    })
    const makeUnifiedTab = (id: string, sortOrder: number) => ({
      id,
      entityId: id,
      groupId,
      worktreeId: WT,
      contentType: 'terminal' as const,
      label: id,
      customLabel: null,
      color: null,
      sortOrder,
      createdAt: sortOrder + 1
    })

    store.setState({
      tabsByWorktree: {
        [WT]: [makeRuntimeTab(hostTabId, 0), makeRuntimeTab(mirrorTabId, 1)]
      },
      ptyIdsByTabId: { [hostTabId]: [], [mirrorTabId]: [] },
      unifiedTabsByWorktree: {
        [WT]: [makeUnifiedTab(hostTabId, 0), makeUnifiedTab(mirrorTabId, 1)]
      },
      groupsByWorktree: {
        [WT]: [
          {
            id: groupId,
            worktreeId: WT,
            activeTabId: hostTabId,
            tabOrder: [hostTabId, mirrorTabId]
          }
        ]
      },
      activeGroupIdByWorktree: { [WT]: groupId }
    })

    const result = store.getState().reconcileWorktreeTabModel(WT)
    const state = store.getState()

    expect(result.renderableTabCount).toBe(1)
    expect(state.tabsByWorktree[WT]?.map((tab) => tab.id)).toEqual([mirrorTabId])
    expect(state.unifiedTabsByWorktree[WT]?.map((tab) => tab.entityId)).toEqual([mirrorTabId])
  })

  it('does not arbitrate duplicate PTY ids from a direct-SSH host snapshot', () => {
    const groupId = 'g-remote'
    const firstTabId = 'remote-terminal-1'
    const secondTabId = 'remote-terminal-2'
    const makeRuntimeTab = (id: string, sortOrder: number) => ({
      id,
      ptyId: 'ssh:target@@shared-pty',
      worktreeId: WT,
      title: id,
      customTitle: null,
      color: null,
      sortOrder,
      createdAt: sortOrder + 1
    })
    const makeUnifiedTab = (id: string, sortOrder: number) => ({
      id,
      entityId: id,
      groupId,
      worktreeId: WT,
      contentType: 'terminal' as const,
      label: id,
      customLabel: null,
      color: null,
      sortOrder,
      createdAt: sortOrder + 1
    })

    store.setState({
      repos: [{ ...TEST_REPO, connectionId: 'target' }],
      tabsByWorktree: {
        [WT]: [makeRuntimeTab(firstTabId, 0), makeRuntimeTab(secondTabId, 1)]
      },
      ptyIdsByTabId: {
        [firstTabId]: ['ssh:target@@shared-pty'],
        [secondTabId]: ['ssh:target@@shared-pty']
      },
      unifiedTabsByWorktree: {
        [WT]: [makeUnifiedTab(firstTabId, 0), makeUnifiedTab(secondTabId, 1)]
      },
      groupsByWorktree: {
        [WT]: [
          {
            id: groupId,
            worktreeId: WT,
            activeTabId: firstTabId,
            tabOrder: [firstTabId, secondTabId]
          }
        ]
      },
      activeGroupIdByWorktree: { [WT]: groupId }
    })

    const result = store.getState().reconcileWorktreeTabModel(WT)

    expect(result.renderableTabCount).toBe(2)
    expect(store.getState().tabsByWorktree[WT]?.map((tab) => tab.id)).toEqual([
      firstTabId,
      secondTabId
    ])
  })

  it.each(['repo1::/tmp/feature', 'folder:restore-history'])(
    'retains checkpoint and agent resume identities through hydration and reconnect for %s',
    async (worktreeId) => {
      const tabId = 'restored-terminal'
      const leafId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      const ptyId = `${worktreeId}@@checkpoint`
      const paneKey = `${tabId}:${leafId}`
      const session: WorkspaceSessionState = {
        ...getDefaultWorkspaceSession(),
        activeWorktreeId: worktreeId,
        activeTabId: tabId,
        activeWorktreeIdsOnShutdown: [worktreeId],
        tabsByWorktree: { [worktreeId]: [makeTab({ id: tabId, worktreeId, ptyId })] },
        terminalLayoutsByTabId: {
          [tabId]: {
            root: { type: 'leaf', leafId },
            activeLeafId: leafId,
            expandedLeafId: null,
            ptyIdsByLeafId: { [leafId]: ptyId }
          }
        },
        sleepingAgentSessionsByPaneKey: {
          [paneKey]: {
            paneKey,
            tabId,
            worktreeId,
            agent: 'codex',
            providerSession: { key: 'session_id', id: 'retained-provider-session' },
            prompt: '',
            state: 'working',
            capturedAt: 1,
            updatedAt: 1,
            origin: 'live'
          }
        }
      }
      store.setState({
        repos: [TEST_REPO],
        worktreesByRepo: worktreeId.startsWith('folder:')
          ? {}
          : { repo1: [makeWorktree({ id: worktreeId, repoId: 'repo1' })] }
      })
      const options = {
        additionalValidWorkspaceKeys: collectFolderWorkspaceKeysFromSession(session)
      }
      store.getState().hydrateWorkspaceSession(session, options)
      store.getState().hydrateTabsSession(session, options)
      store.getState().reconcileWorktreeTabModel(worktreeId)
      await store.getState().reconnectPersistedTerminals()

      const restored = store.getState()
      expect(restored.tabsByWorktree[worktreeId]).toHaveLength(1)
      expect(restored.tabsByWorktree[worktreeId][0]?.ptyId).toBe(ptyId)
      expect(restored.terminalLayoutsByTabId[tabId]?.ptyIdsByLeafId).toEqual({ [leafId]: ptyId })
      expect(restored.sleepingAgentSessionsByPaneKey[paneKey]?.providerSession.id).toBe(
        'retained-provider-session'
      )
      expect(restored.unifiedTabsByWorktree[worktreeId]?.map((tab) => tab.entityId)).toEqual([
        tabId
      ])
    }
  )
  it('releases a shared PTY from a surviving split tab', () => {
    const splitTabId = 'split-terminal-1'
    const mirrorTabId = 'web-terminal-split-terminal-1'

    store.setState({
      tabsByWorktree: {
        [WT]: [
          {
            id: splitTabId,
            ptyId: 'unique-pty',
            worktreeId: WT,
            title: 'Split terminal',
            customTitle: null,
            color: null,
            sortOrder: 0,
            createdAt: 1
          },
          {
            id: mirrorTabId,
            ptyId: 'shared-pty',
            worktreeId: WT,
            title: 'Live mirror',
            customTitle: null,
            color: null,
            sortOrder: 1,
            createdAt: 2
          }
        ]
      },
      terminalLayoutsByTabId: {
        [splitTabId]: {
          root: {
            type: 'split',
            direction: 'vertical',
            first: { type: 'leaf', leafId: 'shared-leaf' },
            second: { type: 'leaf', leafId: 'unique-leaf' }
          },
          activeLeafId: 'shared-leaf',
          expandedLeafId: null,
          ptyIdsByLeafId: {
            'shared-leaf': 'shared-pty',
            'unique-leaf': 'unique-pty'
          }
        }
      },
      ptyIdsByTabId: { [splitTabId]: [], [mirrorTabId]: ['shared-pty'] },
      sleepingAgentSessionsByPaneKey: {
        [`${splitTabId}:shared-leaf`]: {} as never
      },
      unreadTerminalPanes: { [`${splitTabId}:shared-leaf`]: true },
      unreadAgentCompletionPanes: { [`${splitTabId}:shared-leaf`]: true },
      unreadAgentCompletionCountByPane: { [`${splitTabId}:shared-leaf`]: 2 },
      lastTerminalInputAtByPaneKey: { [`${splitTabId}:shared-leaf`]: 123 },
      unifiedTabsByWorktree: { [WT]: [] },
      groupsByWorktree: { [WT]: [] },
      activeGroupIdByWorktree: {}
    })

    const result = store.getState().reconcileWorktreeTabModel(WT)
    const state = store.getState()

    expect(result.renderableTabCount).toBe(2)
    expect(state.tabsByWorktree[WT]?.map((tab) => tab.id)).toEqual([splitTabId, mirrorTabId])
    expect(state.terminalLayoutsByTabId[splitTabId]?.ptyIdsByLeafId).toEqual({
      'unique-leaf': 'unique-pty'
    })
    expect(state.terminalLayoutsByTabId[splitTabId]?.activeLeafId).toBe('unique-leaf')
    expect(state.ptyIdsByTabId[mirrorTabId]).toEqual(['shared-pty'])
    expect(state.sleepingAgentSessionsByPaneKey[`${splitTabId}:shared-leaf`]).toBeUndefined()
    expect(state.unreadTerminalPanes[`${splitTabId}:shared-leaf`]).toBeUndefined()
    expect(state.unreadAgentCompletionPanes[`${splitTabId}:shared-leaf`]).toBeUndefined()
    expect(state.unreadAgentCompletionCountByPane[`${splitTabId}:shared-leaf`]).toBeUndefined()
    expect(state.lastTerminalInputAtByPaneKey[`${splitTabId}:shared-leaf`]).toBeUndefined()
  })
})
