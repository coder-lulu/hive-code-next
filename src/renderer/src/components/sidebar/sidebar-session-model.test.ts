import { describe, expect, it } from 'vitest'
import type { AgentStatusEntry } from '../../../../shared/agent-status-types'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../../shared/constants'
import type { Tab } from '../../../../shared/tab-types'
import type { TerminalTab } from '../../../../shared/terminal-tab-types'
import {
  buildSidebarSessionItems,
  buildTemporarySessionCollection,
  temporarySessionIdentityKey
} from './sidebar-session-model'

function unifiedTab(overrides: Partial<Tab> = {}): Tab {
  return {
    id: 'tab-1',
    entityId: 'entity-1',
    groupId: 'group-1',
    worktreeId: 'wt-1',
    contentType: 'agent-session',
    label: 'Fix login spacing',
    customLabel: null,
    color: null,
    sortOrder: 0,
    createdAt: 100,
    ...overrides
  }
}

function terminalTab(overrides: Partial<TerminalTab> = {}): TerminalTab {
  return {
    id: 'tab-1',
    ptyId: null,
    worktreeId: 'wt-1',
    title: 'codex',
    customTitle: null,
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
    updatedAt: 200,
    stateStartedAt: 150,
    paneKey: 'tab-1:00000000-0000-4000-8000-000000000001',
    stateHistory: [],
    ...overrides
  }
}

describe('buildSidebarSessionItems', () => {
  it('excludes ordinary tabs and de-duplicates unified and legacy agent tabs', () => {
    const items = buildSidebarSessionItems({
      unifiedTabsByWorktree: {
        'wt-1': [
          unifiedTab(),
          unifiedTab({
            id: 'editor-1',
            entityId: 'editor-1',
            contentType: 'editor',
            label: 'README.md'
          })
        ]
      },
      tabsByWorktree: {
        'wt-1': [terminalTab()]
      }
    })

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      id: 'tab-1',
      title: 'Fix login spacing',
      worktreeId: 'wt-1',
      tabId: 'tab-1',
      paneKey: null
    })
  })

  it('keeps standalone floating sessions visible and applies live status', () => {
    const items = buildSidebarSessionItems({
      unifiedTabsByWorktree: {
        [FLOATING_TERMINAL_WORKTREE_ID]: [
          unifiedTab({
            id: 'floating-tab',
            entityId: 'floating-session',
            worktreeId: FLOATING_TERMINAL_WORKTREE_ID,
            structuredSessionId: 'provider-session',
            label: 'Temporary investigation',
            createdAt: 100
          })
        ]
      },
      agentStatusByPaneKey: {
        'floating-tab:00000000-0000-4000-8000-000000000001': statusEntry({
          tabId: 'floating-tab',
          updatedAt: 500,
          stateStartedAt: 500
        })
      }
    })

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      id: 'provider-session',
      title: 'Temporary investigation',
      worktreeId: FLOATING_TERMINAL_WORKTREE_ID,
      status: 'running',
      lastActivityAt: 500,
      paneKey: 'floating-tab:00000000-0000-4000-8000-000000000001'
    })
  })

  it('keeps the exact owner and both tab identities when restored snapshots are merged', () => {
    const ownerBucketKey = `runtime:environment-a|${FLOATING_TERMINAL_WORKTREE_ID}`
    const items = buildSidebarSessionItems({
      unifiedTabsByWorktree: {
        [ownerBucketKey]: [
          unifiedTab({
            id: 'unified-agent-tab',
            entityId: 'provider-session',
            worktreeId: FLOATING_TERMINAL_WORKTREE_ID,
            executionHostId: 'runtime:environment-a',
            structuredSessionId: 'provider-session',
            createdAt: 100
          })
        ]
      },
      tabsByWorktree: {
        [ownerBucketKey]: [
          terminalTab({
            id: 'terminal-pane-tab',
            worktreeId: FLOATING_TERMINAL_WORKTREE_ID,
            aiVaultTitle: {
              agent: 'codex',
              title: 'Temporary investigation',
              sessionId: 'provider-session'
            },
            createdAt: 200
          })
        ]
      },
      agentStatusByPaneKey: {
        'terminal-pane-tab:00000000-0000-4000-8000-000000000001': statusEntry({
          tabId: 'terminal-pane-tab',
          worktreeId: ownerBucketKey,
          updatedAt: 500,
          stateStartedAt: 500
        })
      }
    })

    expect(items).toMatchObject([
      {
        id: 'provider-session',
        ownerBucketKey,
        unifiedTabId: 'unified-agent-tab',
        terminalTabId: 'terminal-pane-tab',
        tabId: 'unified-agent-tab',
        executionHostId: 'runtime:environment-a',
        status: 'running',
        lastActivityAt: 500
      }
    ])
  })

  it('filters workspace-owned sessions out of the temporary section', () => {
    const items = buildSidebarSessionItems({
      unifiedTabsByWorktree: {
        [FLOATING_TERMINAL_WORKTREE_ID]: [
          unifiedTab({
            id: 'floating-tab',
            worktreeId: FLOATING_TERMINAL_WORKTREE_ID,
            label: 'Temporary'
          })
        ],
        'wt-1': [unifiedTab({ id: 'workspace-tab', label: 'Workspace' })]
      },
      temporaryOnly: true
    })

    expect(items.map((item) => item.id)).toEqual(['floating-tab'])
  })

  it('does not invent rows for unidentifiable status entries', () => {
    const items = buildSidebarSessionItems({
      agentStatusByPaneKey: {
        'unknown-pane': statusEntry({
          tabId: undefined,
          providerSession: undefined,
          worktreeId: undefined
        })
      }
    })
    expect(items).toEqual([])
  })

  it('does not present a status-only temporary record as a restorable session', () => {
    const items = buildSidebarSessionItems({
      retainedAgentsByPaneKey: {
        'missing-tab:00000000-0000-4000-8000-000000000001': {
          entry: statusEntry({
            state: 'done',
            tabId: 'missing-tab',
            worktreeId: FLOATING_TERMINAL_WORKTREE_ID,
            providerSession: { key: 'session_id', id: 'provider-session' }
          })
        }
      },
      temporaryOnly: true
    })

    expect(items).toEqual([])
  })

  it('preserves host ownership when mirrored tab buckets share a worktree id', () => {
    const items = buildSidebarSessionItems({
      unifiedTabsByWorktree: {
        'runtime:host-a|wt-shared': [
          unifiedTab({
            id: 'agent-a',
            entityId: 'session-shared',
            worktreeId: 'wt-shared',
            structuredSessionId: 'session-shared'
          })
        ],
        'runtime:host-b|wt-shared': [
          unifiedTab({
            id: 'agent-b',
            entityId: 'session-shared',
            worktreeId: 'wt-shared',
            structuredSessionId: 'session-shared'
          })
        ]
      }
    })

    expect(items).toHaveLength(2)
    expect(new Set(items.map((item) => item.executionHostId))).toEqual(
      new Set(['runtime:host-a', 'runtime:host-b'])
    )
  })

  it('normalizes host-qualified buckets before activation', () => {
    const items = buildSidebarSessionItems({
      unifiedTabsByWorktree: {
        'runtime:host-a|wt-shared': [
          unifiedTab({
            id: 'agent-a',
            entityId: 'session-a',
            worktreeId: ''
          })
        ]
      },
      workspaceLabels: new Map([['wt-shared', 'Shared workspace']])
    })

    expect(items).toMatchObject([
      {
        worktreeId: 'wt-shared',
        executionHostId: 'runtime:host-a',
        contextLabel: 'Shared workspace'
      }
    ])
  })

  it('does not apply an unqualified status hook to one of two mirrored hosts', () => {
    const items = buildSidebarSessionItems({
      unifiedTabsByWorktree: {
        'runtime:host-a|wt-shared': [
          unifiedTab({ id: 'same-tab', entityId: 'session-a', worktreeId: 'wt-shared' })
        ],
        'runtime:host-b|wt-shared': [
          unifiedTab({ id: 'same-tab', entityId: 'session-b', worktreeId: 'wt-shared' })
        ]
      },
      agentStatusByPaneKey: {
        'same-tab:00000000-0000-4000-8000-000000000001': statusEntry({
          tabId: 'same-tab',
          worktreeId: 'wt-shared',
          updatedAt: 500
        })
      }
    })

    expect(items).toHaveLength(2)
    expect(items.every((item) => item.lastActivityAt === 100)).toBe(true)
  })

  it('removes a project-assigned floating session from the temporary section', () => {
    const items = buildSidebarSessionItems({
      unifiedTabsByWorktree: {
        [FLOATING_TERMINAL_WORKTREE_ID]: [
          unifiedTab({
            id: 'floating-tab',
            worktreeId: FLOATING_TERMINAL_WORKTREE_ID,
            projectAssignment: {
              projectId: 'project-1',
              projectIdentityKey: 'local|project:project-1',
              projectGroupId: 'space-1',
              executionHostId: 'local',
              assignedAt: 100
            }
          })
        ]
      },
      temporaryOnly: true
    })

    expect(items).toEqual([])
  })

  it('returns the top four temporary sessions with the untruncated total', () => {
    const tabs = Array.from({ length: 6 }, (_, index) =>
      unifiedTab({
        id: `temporary-${index + 1}`,
        entityId: `temporary-entity-${index + 1}`,
        worktreeId: FLOATING_TERMINAL_WORKTREE_ID,
        label: `Temporary ${index + 1}`,
        lastFocusedAt: index + 1
      })
    )
    const input = {
      unifiedTabsByWorktree: {
        [FLOATING_TERMINAL_WORKTREE_ID]: tabs,
        'wt-1': [unifiedTab({ id: 'workspace-session', entityId: 'workspace-session' })]
      }
    }

    const preview = buildTemporarySessionCollection(input, { limit: 4 })
    const complete = buildTemporarySessionCollection(input)

    expect(preview.totalCount).toBe(6)
    expect(preview.items.map((item) => item.id)).toEqual([
      'temporary-6',
      'temporary-5',
      'temporary-4',
      'temporary-3'
    ])
    expect(complete.totalCount).toBe(6)
    expect(complete.items).toHaveLength(6)
  })

  it('uses the state transition time instead of same-state heartbeat time', () => {
    const sessionInput = {
      unifiedTabsByWorktree: {
        [FLOATING_TERMINAL_WORKTREE_ID]: [
          unifiedTab({
            id: 'floating-tab',
            entityId: 'floating-tab',
            worktreeId: FLOATING_TERMINAL_WORKTREE_ID
          })
        ]
      }
    }
    const paneKey = 'floating-tab:00000000-0000-4000-8000-000000000001'
    const first = buildTemporarySessionCollection({
      ...sessionInput,
      agentStatusByPaneKey: {
        [paneKey]: statusEntry({ tabId: 'floating-tab', updatedAt: 500, stateStartedAt: 150 })
      }
    })
    const heartbeat = buildTemporarySessionCollection({
      ...sessionInput,
      agentStatusByPaneKey: {
        [paneKey]: statusEntry({ tabId: 'floating-tab', updatedAt: 900, stateStartedAt: 150 })
      }
    })

    expect(first.items[0]?.lastActivityAt).toBe(150)
    expect(heartbeat.items[0]?.lastActivityAt).toBe(150)
  })

  it('keeps identical provider identities distinct across host-qualified buckets', () => {
    const local = buildTemporarySessionCollection({
      unifiedTabsByWorktree: {
        [`runtime:host-a|${FLOATING_TERMINAL_WORKTREE_ID}`]: [
          unifiedTab({
            id: 'tab-a',
            entityId: 'provider-session',
            worktreeId: FLOATING_TERMINAL_WORKTREE_ID,
            structuredSessionId: 'provider-session'
          })
        ],
        [`runtime:host-b|${FLOATING_TERMINAL_WORKTREE_ID}`]: [
          unifiedTab({
            id: 'tab-b',
            entityId: 'provider-session',
            worktreeId: FLOATING_TERMINAL_WORKTREE_ID,
            structuredSessionId: 'provider-session'
          })
        ]
      }
    })

    expect(local.items).toHaveLength(2)
    expect(new Set(local.items.map(temporarySessionIdentityKey)).size).toBe(2)
  })
})
