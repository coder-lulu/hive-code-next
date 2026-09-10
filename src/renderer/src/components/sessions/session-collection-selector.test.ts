import { describe, expect, it, vi } from 'vitest'
import type { AppState } from '@/store/types'
import type { AgentStatusEntry } from '../../../../shared/agent-status-types'

vi.mock('@/store', () => ({ useAppStore: vi.fn() }))
vi.mock('./use-session-journal-statuses', () => ({ useSessionJournalStatuses: vi.fn() }))
vi.mock('@/lib/session-navigation', () => ({ resolveSessionConnectionState: () => 'connected' }))
import { createSessionCollectionSelector } from './use-session-collection'
import { createSessionCatalogSelector } from './session-catalog'

function state(): AppState {
  const now = Date.now()
  return {
    repos: [],
    worktreesByRepo: {},
    folderWorkspaces: [],
    projectGroups: [],
    projects: [],
    projectHostSetups: [],
    settings: {},
    runtimeEnvironments: [],
    sshTargetLabels: new Map(),
    removedSshTargetLabels: new Map(),
    sshStateByEnvironment: new Map(),
    sshConnectionStates: new Map(),
    runtimeStatusByEnvironmentId: new Map(),
    unifiedTabsByWorktree: {},
    tabsByWorktree: {
      'global-floating-terminal': [
        {
          id: 'terminal',
          worktreeId: 'global-floating-terminal',
          title: 'Review completed errors',
          customTitle: null,
          color: null,
          sortOrder: 0,
          createdAt: now - 100_000,
          ptyId: 'pty',
          launchAgent: 'claude'
        }
      ]
    },
    agentStatusEpoch: 1,
    agentStatusByPaneKey: {
      'terminal:11111111-1111-4111-8111-111111111111': {
        paneKey: 'terminal:11111111-1111-4111-8111-111111111111',
        tabId: 'terminal',
        worktreeId: 'local|global-floating-terminal',
        state: 'working',
        prompt: '',
        updatedAt: now,
        stateStartedAt: now - 1000,
        stateHistory: [],
        observation: {
          origin: 'hook',
          kind: 'transition',
          authorityId: 'local',
          incarnation: 1,
          revision: 1,
          observedAt: now
        }
      }
    }
  } as unknown as AppState
}

describe('shared session collection selector', () => {
  it('keeps one snapshot across heartbeat copies and UI-only navigation changes', () => {
    const source = state()
    const selector = createSessionCollectionSelector()
    const before = selector(source)
    const entry = Object.values(source.agentStatusByPaneKey)[0] as AgentStatusEntry
    const heartbeat = {
      ...source,
      sessionsView: {
        scope: { kind: 'all' },
        query: 'error',
        selectedSessionKey: 'terminal',
        scrollTop: 500
      },
      agentStatusByPaneKey: { [entry.paneKey]: { ...entry, updatedAt: Date.now() + 1 } }
    } as AppState
    expect(before.items[0].status.activity).toBe('running')
    expect(selector(heartbeat)).toBe(before)
    expect(selector({ ...heartbeat, activeTabId: 'other' })).toBe(before)
  })

  it('rebuilds at a real semantic epoch and retains the actual transition clock', () => {
    const source = state()
    const selector = createSessionCollectionSelector()
    const before = selector(source)
    const entry = Object.values(source.agentStatusByPaneKey)[0] as AgentStatusEntry
    const after = selector({
      ...source,
      agentStatusEpoch: 2,
      agentStatusByPaneKey: { [entry.paneKey]: { ...entry, state: 'waiting' } }
    })
    expect(after).not.toBe(before)
    expect(after.items[0].status.activity).toBe('waiting')
    expect(after.items[0].lastActivityAt).toBe(before.items[0].lastActivityAt)
  })

  it('does not rebuild the projects-only catalog for session activity or selection', () => {
    const source = state()
    const selector = createSessionCatalogSelector()
    const before = selector(source)
    expect(selector({ ...source, agentStatusEpoch: 99, activeTabId: 'another' })).toBe(before)
    expect(selector({ ...source, tabsByWorktree: {} })).toBe(before)
  })
})
