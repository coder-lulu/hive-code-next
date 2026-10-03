// @vitest-environment happy-dom

import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Tab } from '../../../../shared/tab-types'
import type { AppState } from '@/store/types'

type MockState = Pick<
  AppState,
  | 'unifiedTabsByWorktree'
  | 'agentStatusByPaneKey'
  | 'repos'
  | 'worktreesByRepo'
  | 'folderWorkspaces'
  | 'projectGroups'
  | 'setAgentStatus'
  | 'removeAgentStatus'
>

const mocks = vi.hoisted(() => ({
  store: null as { setState: (patch: Partial<MockState>) => void } | null,
  subscribe: vi.fn(),
  setAgentStatus: vi.fn(),
  removeAgentStatus: vi.fn()
}))
vi.mock('@/store', async () => {
  const { create } = await import('zustand')
  const useAppStore = create<MockState>(() => ({
    unifiedTabsByWorktree: {},
    agentStatusByPaneKey: {},
    repos: [],
    worktreesByRepo: {},
    folderWorkspaces: [],
    projectGroups: [],
    setAgentStatus: mocks.setAgentStatus,
    removeAgentStatus: mocks.removeAgentStatus
  }))
  mocks.store = useAppStore
  return { useAppStore }
})
vi.mock('@/runtime/runtime-rpc-client', () => ({
  runtimeEnvironmentSupportsCapability: () => Promise.resolve(true)
}))
vi.mock('@/runtime/structured-agent-session-client', () => ({
  subscribeStructuredAgentSessionStatus: mocks.subscribe
}))

import { StructuredAgentSessionStatusBridge } from './StructuredAgentSessionStatusBridge'
import { resetStructuredAgentSessionStatusFeedsForTests } from '@/runtime/structured-agent-session-status-feed'

const tab: Tab = {
  id: 'tab-1',
  entityId: 'session-1',
  worktreeId: 'shared',
  groupId: 'group',
  contentType: 'agent-session',
  agentSessionAgent: 'codex',
  label: 'Chat',
  customLabel: null,
  color: null,
  sortOrder: 0,
  createdAt: 1
}

describe('structured status feed execution ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.subscribe.mockResolvedValue({ unsubscribe: vi.fn() })
    mocks.store?.setState({ unifiedTabsByWorktree: {}, agentStatusByPaneKey: {} })
  })
  afterEach(() => {
    cleanup()
    resetStructuredAgentSessionStatusFeedsForTests()
  })

  it('uses a raw bucket tab explicit runtime without an ambient local fallback', async () => {
    mocks.store?.setState({
      unifiedTabsByWorktree: {
        shared: [{ ...tab, executionHostId: 'runtime:cloud' }]
      }
    })
    render(<StructuredAgentSessionStatusBridge />)
    await waitFor(() => expect(mocks.subscribe).toHaveBeenCalledOnce())
    expect(mocks.subscribe.mock.calls[0][0]).toEqual({
      kind: 'environment',
      environmentId: 'cloud'
    })
  })

  it.each([
    { bucket: 'shared', host: 'ssh:alpha' },
    { bucket: 'local|shared', host: 'runtime:cloud' }
  ] as const)(
    'does not subscribe from an unsupported or conflicting owner: %j',
    async ({ bucket, host }) => {
      mocks.store?.setState({
        unifiedTabsByWorktree: { [bucket]: [{ ...tab, executionHostId: host }] }
      })
      render(<StructuredAgentSessionStatusBridge />)
      await act(() => Promise.resolve())
      expect(mocks.subscribe).not.toHaveBeenCalled()
      expect(mocks.setAgentStatus).not.toHaveBeenCalled()
    }
  )

  it('activates separate same-session host feeds without overwriting an ambiguous legacy pane', async () => {
    mocks.store?.setState({
      unifiedTabsByWorktree: {
        'local|shared': [tab],
        'runtime:cloud|shared': [tab]
      }
    })
    render(<StructuredAgentSessionStatusBridge />)
    await waitFor(() => expect(mocks.subscribe).toHaveBeenCalledTimes(2))
    expect(mocks.subscribe.mock.calls.map(([target]) => target)).toEqual([
      { kind: 'local' },
      { kind: 'environment', environmentId: 'cloud' }
    ])
    act(() => {
      for (const [, emit] of mocks.subscribe.mock.calls) {
        emit({
          type: 'status',
          session: {
            sessionId: 'session-1',
            workspaceId: 'shared',
            agent: 'codex',
            status: 'working',
            latestPrompt: '',
            updatedAt: 100
          }
        })
      }
    })
    expect(mocks.setAgentStatus).not.toHaveBeenCalled()
  })
})
