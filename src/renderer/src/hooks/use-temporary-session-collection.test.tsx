// @vitest-environment happy-dom

import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AgentStatusEntry } from '../../../shared/agent-status-types'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../shared/constants'
import type { Tab } from '../../../shared/tab-types'
import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import { useTemporarySessionCollection } from './use-temporary-session-collection'

type SessionStoreState = Pick<
  AppState,
  | 'unifiedTabsByWorktree'
  | 'tabsByWorktree'
  | 'agentStatusByPaneKey'
  | 'retainedAgentsByPaneKey'
  | 'agentStatusEpoch'
>

function unifiedTab(overrides: Partial<Tab> = {}): Tab {
  return {
    id: 'floating-tab',
    entityId: 'floating-session',
    groupId: 'group-1',
    worktreeId: FLOATING_TERMINAL_WORKTREE_ID,
    contentType: 'agent-session',
    label: 'Temporary investigation',
    customLabel: null,
    color: null,
    sortOrder: 0,
    createdAt: 100,
    ...overrides
  }
}

function statusEntry(overrides: Partial<AgentStatusEntry> = {}): AgentStatusEntry {
  return {
    state: 'working',
    prompt: 'Inspect the login page',
    updatedAt: 500,
    stateStartedAt: 150,
    paneKey: 'floating-tab:00000000-0000-4000-8000-000000000001',
    tabId: 'floating-tab',
    worktreeId: FLOATING_TERMINAL_WORKTREE_ID,
    stateHistory: [],
    ...overrides
  }
}

let previousState: SessionStoreState

beforeEach(() => {
  const state = useAppStore.getState()
  previousState = {
    unifiedTabsByWorktree: state.unifiedTabsByWorktree,
    tabsByWorktree: state.tabsByWorktree,
    agentStatusByPaneKey: state.agentStatusByPaneKey,
    retainedAgentsByPaneKey: state.retainedAgentsByPaneKey,
    agentStatusEpoch: state.agentStatusEpoch
  }
})

afterEach(() => {
  cleanup()
  useAppStore.setState(previousState)
})

describe('useTemporarySessionCollection', () => {
  it('ignores same-state heartbeat map copies and rebuilds on agentStatusEpoch', () => {
    const paneKey = 'floating-tab:00000000-0000-4000-8000-000000000001'
    useAppStore.setState({
      unifiedTabsByWorktree: {
        [FLOATING_TERMINAL_WORKTREE_ID]: [unifiedTab()]
      },
      tabsByWorktree: {},
      agentStatusByPaneKey: { [paneKey]: statusEntry() },
      retainedAgentsByPaneKey: {},
      agentStatusEpoch: 10
    })
    let renderCount = 0
    const hook = renderHook(() => {
      renderCount += 1
      return useTemporarySessionCollection({ limit: 4 })
    })
    const initialRenderCount = renderCount
    const initialCollection = hook.result.current

    act(() => {
      useAppStore.setState({
        agentStatusByPaneKey: {
          [paneKey]: statusEntry({ updatedAt: 900, stateStartedAt: 150 })
        }
      })
    })

    expect(renderCount).toBe(initialRenderCount)
    expect(hook.result.current).toBe(initialCollection)
    expect(hook.result.current.items[0]?.lastActivityAt).toBe(150)

    act(() => {
      useAppStore.setState({
        agentStatusByPaneKey: {
          [paneKey]: statusEntry({ state: 'waiting', updatedAt: 950, stateStartedAt: 950 })
        },
        agentStatusEpoch: 11
      })
    })

    expect(renderCount).toBeGreaterThan(initialRenderCount)
    expect(hook.result.current).not.toBe(initialCollection)
    expect(hook.result.current.items[0]).toMatchObject({
      status: 'waiting',
      lastActivityAt: 950
    })
  })

  it('subscribes only to local and host-qualified floating buckets', () => {
    const floatingTabs = [unifiedTab()]
    const remoteBucket = `runtime:host-a|${FLOATING_TERMINAL_WORKTREE_ID}`
    const remoteTabs = [
      unifiedTab({
        id: 'remote-tab',
        entityId: 'remote-session',
        executionHostId: 'runtime:host-a'
      })
    ]
    useAppStore.setState({
      unifiedTabsByWorktree: {
        [FLOATING_TERMINAL_WORKTREE_ID]: floatingTabs,
        [remoteBucket]: remoteTabs,
        'wt-1': [unifiedTab({ id: 'workspace-tab', worktreeId: 'wt-1' })]
      },
      tabsByWorktree: {},
      agentStatusByPaneKey: {},
      retainedAgentsByPaneKey: {},
      agentStatusEpoch: 20
    })
    let renderCount = 0
    const hook = renderHook(() => {
      renderCount += 1
      return useTemporarySessionCollection()
    })
    const initialRenderCount = renderCount
    const initialCollection = hook.result.current

    expect(initialCollection.totalCount).toBe(2)

    act(() => {
      useAppStore.setState({
        unifiedTabsByWorktree: {
          [FLOATING_TERMINAL_WORKTREE_ID]: floatingTabs,
          [remoteBucket]: remoteTabs,
          'wt-1': [
            unifiedTab({ id: 'workspace-tab-2', entityId: 'workspace-tab-2', worktreeId: 'wt-1' })
          ]
        }
      })
    })

    expect(renderCount).toBe(initialRenderCount)
    expect(hook.result.current).toBe(initialCollection)
  })
})
