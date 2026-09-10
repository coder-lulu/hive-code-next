import { describe, expect, it } from 'vitest'
import {
  AGENT_STATUS_STALE_AFTER_MS,
  type AgentStatusEntry
} from '../../../../shared/agent-status-types'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../../shared/constants'
import type { ExecutionHostId } from '../../../../shared/execution-host'
import type { Tab } from '../../../../shared/tab-types'
import type { TerminalTab } from '../../../../shared/terminal-tab-types'
import { buildHomeEntities } from '../landing/desktop-home-model-entities'
import type { BuildDesktopHomeModelInput } from '../landing/desktop-home-model-types'
import {
  buildSessionInventory,
  buildSessionInventoryProjection,
  createSessionHookMatcher,
  filterSessionInventory,
  findSessionHook,
  projectSessionHookStatus,
  sessionProjects,
  sessionStatusIdentity,
  type SessionInventoryInput
} from './session-list-model'

const now = 2_000_000
const hosts: ExecutionHostId[] = ['local', 'ssh:alpha', 'runtime:cloud']

function terminal(patch: Partial<TerminalTab> = {}): TerminalTab {
  return {
    id: 'terminal-1',
    worktreeId: 'shared',
    ptyId: 'pty-1',
    title: 'Agent work',
    customTitle: null,
    color: null,
    sortOrder: 0,
    createdAt: 100,
    launchAgent: 'claude',
    ...patch
  }
}

function unified(patch: Partial<Tab> = {}): Tab {
  return {
    id: 'unified-1',
    entityId: 'terminal-1',
    groupId: 'group-1',
    worktreeId: 'shared',
    contentType: 'terminal',
    label: 'Agent work',
    customLabel: null,
    color: null,
    sortOrder: 0,
    createdAt: 100,
    agentSessionAgent: 'claude',
    ...patch
  }
}

function input(
  patch: Partial<SessionInventoryInput> = {},
  executionHosts: ExecutionHostId[] = ['local']
): SessionInventoryInput {
  const repos = executionHosts.map((executionHostId, index) => ({
    id: `repo-${index}`,
    displayName: 'Shared project',
    path: '/repo',
    executionHostId
  }))
  const home: BuildDesktopHomeModelInput = {
    repos,
    openFiles: [],
    tabsByWorktree: {},
    unifiedTabsByWorktree: {},
    worktreesByRepo: Object.fromEntries(
      repos.map((repo) => [
        repo.id,
        [
          {
            id: 'shared',
            repoId: repo.id,
            displayName: 'Shared worktree',
            path: '/repo/work',
            hostId: repo.executionHostId
          }
        ]
      ])
    ),
    folderWorkspaces: executionHosts.map((executionHostId) => ({
      id: 'notes',
      projectGroupId: 'group',
      name: 'Notes',
      folderPath: '/notes',
      executionHostId
    }))
  }
  return {
    now,
    entities: buildHomeEntities(home, repos),
    agentStatusByPaneKey: {},
    unifiedTabsByWorktree: {},
    tabsByWorktree: {},
    ...patch
  }
}

function hook(patch: Partial<AgentStatusEntry> = {}): AgentStatusEntry {
  return {
    paneKey: 'terminal-1:00000000-0000-4000-8000-000000000001',
    tabId: 'terminal-1',
    worktreeId: 'local|shared',
    state: 'working',
    prompt: '',
    updatedAt: now - 10,
    stateStartedAt: now - 1000,
    stateHistory: [],
    observation: {
      origin: 'hook',
      kind: 'transition',
      authorityId: 'local-authority',
      incarnation: 1,
      revision: 1,
      observedAt: now - 10
    },
    ...patch
  }
}

describe('current session inventory', () => {
  it('merges unified and terminal representations while retaining exact restore coordinates', () => {
    const items = buildSessionInventory(
      input({
        unifiedTabsByWorktree: { shared: [unified({ customLabel: 'Review change' })] },
        tabsByWorktree: { shared: [terminal()] }
      })
    )
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      title: 'Review change',
      unifiedTabId: 'unified-1',
      terminalTabId: 'terminal-1',
      groupId: 'group-1',
      ownerBucketKey: 'shared',
      executionHostId: 'local',
      workspaceLabel: 'Shared worktree',
      projectKey: 'local|project:repo-0'
    })
    expect(sessionStatusIdentity(items[0])).toMatchObject({
      ownerBucketKey: 'local|shared',
      executionHostId: 'local',
      tabId: 'terminal-1'
    })
  })

  it('excludes ordinary shells and browser tabs even when their labels look like agent states', () => {
    expect(
      buildSessionInventory(
        input({
          unifiedTabsByWorktree: {
            shared: [
              unified({ agentSessionAgent: undefined, label: 'Claude working done failed' }),
              unified({ id: 'browser', contentType: 'browser' })
            ]
          },
          tabsByWorktree: {
            shared: [terminal({ launchAgent: undefined, title: 'Agent completed' })]
          },
          agentStatusByPaneKey: { status: hook() }
        })
      )
    ).toEqual([])
  })

  it('retains a stable agent session after its transient PTY has exited', () => {
    const items = buildSessionInventory(
      input({ tabsByWorktree: { shared: [terminal({ ptyId: null })] } })
    )
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      terminalTabId: 'terminal-1',
      unifiedTabId: null,
      kind: 'terminal'
    })
  })

  it.each(hosts)('keeps same-id worktree sessions on their %s owner', (executionHostId) => {
    const owner = `${executionHostId}|shared`
    const items = buildSessionInventory(input({ tabsByWorktree: { [owner]: [terminal()] } }, hosts))
    expect(items[0]).toMatchObject({ ownerBucketKey: owner, executionHostId, worktreeId: 'shared' })
    expect(items[0].projectKey?.startsWith(`${executionHostId}|project:`)).toBe(true)
    expect(sessionStatusIdentity(items[0])?.ownerBucketKey).toBe(owner)
  })

  it.each(hosts)(
    'resolves a folder session on %s without assuming a git worktree',
    (executionHostId) => {
      const owner = `${executionHostId}|folder:notes`
      const items = buildSessionInventory(
        input({ tabsByWorktree: { [owner]: [terminal({ worktreeId: 'folder:notes' })] } }, hosts)
      )
      expect(items[0]).toMatchObject({
        executionHostId,
        worktreeId: 'folder:notes',
        workspaceLabel: 'Notes',
        workspacePath: '/notes',
        projectKey: null
      })
      expect(
        filterSessionInventory(
          items,
          { kind: 'workspace', workspaceKey: 'folder:notes', executionHostId },
          ''
        )
      ).toEqual(items)
    }
  )

  it('leaves a bare same-id bucket unqualified when several hosts can own it', () => {
    const items = buildSessionInventory(input({ tabsByWorktree: { shared: [terminal()] } }, hosts))
    expect(items[0]).toMatchObject({
      executionHostId: null,
      projectKey: null,
      workspaceLabel: null
    })
    expect(sessionStatusIdentity(items[0])).toBeNull()
    expect(findSessionHook(items[0], items, { entry: hook() })).toBeNull()
  })

  it('does not accept a unified tab host that contradicts its owner bucket', () => {
    const items = buildSessionInventory(
      input(
        {
          unifiedTabsByWorktree: { 'local|shared': [unified({ executionHostId: 'ssh:alpha' })] }
        },
        hosts
      )
    )
    expect(items[0].executionHostId).toBeNull()
    expect(sessionStatusIdentity(items[0])).toBeNull()
  })

  it('keeps structured sessions with their provider identity and excludes terminal hooks', () => {
    const items = buildSessionInventory(
      input({
        unifiedTabsByWorktree: {
          shared: [
            unified({
              contentType: 'agent-session',
              entityId: 'internal-1',
              structuredSessionId: 'internal-1',
              aiVaultTitle: { agent: 'claude', sessionId: 'provider-1', title: 'Conversation' }
            })
          ]
        }
      })
    )
    expect(items[0]).toMatchObject({
      kind: 'structured',
      providerSessionId: 'provider-1',
      groupId: 'group-1'
    })
    expect(findSessionHook(items[0], items, { status: hook() })).toBeNull()
  })
})

describe('session status identity and stable activity clocks', () => {
  const inventory = () =>
    buildSessionInventory(
      input(
        {
          tabsByWorktree: Object.fromEntries(hosts.map((host) => [`${host}|shared`, [terminal()]]))
        },
        hosts
      )
    )

  it('matches qualified hooks to their host and rejects an ambiguous bare hook', () => {
    const items = inventory()
    const remote = hook({ worktreeId: 'ssh:alpha|shared' })
    const entries = { remote, bare: hook({ worktreeId: 'shared' }) }
    expect(findSessionHook(items[0], items, entries)).toBeNull()
    expect(findSessionHook(items[1], items, entries)).toBe(remote)
    expect(findSessionHook(items[2], items, entries)).toBeNull()
  })

  it('rejects an old provider session even when the terminal tab and host match', () => {
    const items = buildSessionInventory(
      input({
        tabsByWorktree: {
          shared: [
            terminal({
              aiVaultTitle: { agent: 'claude', sessionId: 'current', title: 'Current' }
            })
          ]
        }
      })
    )
    expect(
      findSessionHook(items[0], items, {
        old: hook({ providerSession: { key: 'session_id', id: 'old' } })
      })
    ).toBeNull()
  })

  it('does not arbitrarily choose one conversation from a split terminal', () => {
    const [item] = inventory()
    expect(
      findSessionHook(item, [item], {
        first: hook(),
        second: hook({ paneKey: 'terminal-1:00000000-0000-4000-8000-000000000002' })
      })
    ).toBeNull()
  })

  it('does not infer status or recency from title edits and focus timestamps', () => {
    const build = (patch: Partial<Tab>) =>
      buildSessionInventory(
        input({
          unifiedTabsByWorktree: { shared: [unified(patch)] },
          tabsByWorktree: { shared: [terminal()] }
        })
      )[0]
    const before = build({})
    const after = build({ customLabel: 'Done with failed permission handler', lastFocusedAt: now })
    expect(after.status.activity).toBe('unknown')
    expect(after.lastActivityAt).toBe(before.lastActivityAt)
    const identityRefresh = hook({ observation: { ...hook().observation!, kind: 'identity-only' } })
    expect(projectSessionHookStatus(after, identityRefresh, 'connected', now).status.activity).toBe(
      'unknown'
    )
    expect(projectSessionHookStatus(after, identityRefresh, 'connected', now).lastActivityAt).toBe(
      100
    )
  })

  it('uses the transition clock for ordering while heartbeat receipts only refresh status evidence', () => {
    const [item] = inventory()
    const transition = hook()
    const heartbeat = hook({
      updatedAt: now,
      observation: { ...transition.observation!, kind: 'snapshot', observedAt: now, revision: 2 }
    })
    const before = projectSessionHookStatus(item, transition, 'connected', now)
    const after = projectSessionHookStatus(item, heartbeat, 'connected', now)
    expect(before.status.activity).toBe('running')
    expect(after.status.activity).toBe('running')
    expect(after.lastActivityAt).toBe(now - 1000)
    expect(after.lastActivityAt).toBe(before.lastActivityAt)
  })

  it('keeps disconnection separate from known activity and never reports process exit from lost contact', () => {
    const [item] = inventory()
    expect(projectSessionHookStatus(item, hook(), 'disconnected', now).status).toMatchObject({
      connection: 'disconnected',
      execution: 'unverifiable'
    })
  })
})

describe('session scope and search', () => {
  it('uses an explicit same-host project assignment before the physical workspace project', () => {
    const repos = [
      { id: 'source', displayName: 'Source', path: '/source', executionHostId: 'local' as const },
      { id: 'target', displayName: 'Target', path: '/target', executionHostId: 'local' as const }
    ]
    const home: BuildDesktopHomeModelInput = {
      repos,
      tabsByWorktree: {},
      openFiles: [],
      worktreesByRepo: {
        source: [
          {
            id: 'shared',
            repoId: 'source',
            displayName: 'Original workspace',
            path: '/source/work',
            hostId: 'local'
          }
        ]
      }
    }
    const items = buildSessionInventory(
      input({
        entities: buildHomeEntities(home, repos),
        tabsByWorktree: {
          shared: [
            terminal({
              projectAssignment: {
                projectId: 'target',
                projectIdentityKey: 'local|project:target',
                executionHostId: 'local',
                projectGroupId: null,
                assignedAt: now
              }
            })
          ]
        }
      })
    )
    expect(items[0]).toMatchObject({
      projectKey: 'local|project:target',
      projectLabel: 'Target',
      workspacePath: '/source/work',
      ownerBucketKey: 'shared'
    })
    expect(
      filterSessionInventory(items, { kind: 'project', projectKey: 'local|project:source' }, '')
    ).toEqual([])
    expect(
      filterSessionInventory(items, { kind: 'project', projectKey: 'local|project:target' }, '')
    ).toEqual(items)
  })

  it('filters project, unassigned and workspace scopes using the current entity projection', () => {
    const source = input(
      {
        tabsByWorktree: {
          'local|shared': [terminal({ customTitle: 'Local deploy' })],
          'ssh:alpha|shared': [terminal({ customTitle: 'Remote deploy' })],
          'local|folder:notes': [terminal({ customTitle: 'Write notes' })],
          [FLOATING_TERMINAL_WORKTREE_ID]: [terminal({ customTitle: 'Unassigned deploy' })]
        }
      },
      hosts
    )
    const items = buildSessionInventory(source)
    expect(filterSessionInventory(items, { kind: 'all' }, '')).toHaveLength(4)
    expect(
      filterSessionInventory(
        items,
        { kind: 'project', projectKey: 'local|project:repo-0' },
        'DEPLOY'
      ).map((item) => item.title)
    ).toEqual(['Local deploy'])
    expect(
      filterSessionInventory(items, { kind: 'unassigned' }, 'deploy').map((item) => item.title)
    ).toEqual(['Unassigned deploy'])
    expect(
      filterSessionInventory(
        items,
        { kind: 'workspace', workspaceKey: 'worktree:shared', executionHostId: 'ssh:alpha' },
        'deploy'
      ).map((item) => item.title)
    ).toEqual(['Remote deploy'])
    expect(
      filterSessionInventory(
        items,
        { kind: 'project', projectKey: 'local|project:repo-0' },
        'remote'
      )
    ).toEqual([])
    expect(
      sessionProjects(source.entities, (host) => host).map((project) => project.key)
    ).toHaveLength(3)
  })
})

describe('current provider metadata and semantic deduplication', () => {
  const leafId = '00000000-0000-4000-8000-000000000001'
  const currentLayouts = {
    'terminal-1': {
      root: { type: 'leaf' as const, leafId },
      activeLeafId: leafId,
      expandedLeafId: null
    }
  }
  const vaultTitle = {
    agent: 'claude' as const,
    sessionId: 'provider-1',
    title: 'Cached conversation'
  }
  const providerHook = (patch: Partial<AgentStatusEntry> = {}) =>
    hook({
      agentType: 'claude',
      providerSession: { key: 'session_id', id: 'provider-1' },
      ...patch
    })

  it('keeps the structured session handle distinct from the provider token', () => {
    const [item] = buildSessionInventory(
      input({
        unifiedTabsByWorktree: {
          shared: [
            unified({
              contentType: 'agent-session',
              entityId: 'internal-handle',
              structuredSessionId: 'internal-handle'
            })
          ]
        }
      })
    )
    expect(item).toMatchObject({ id: 'internal-handle', providerSessionId: null })
  })

  it.each([true, false])(
    'prefers the structured representation for one provider regardless of input order (%s)',
    (structuredFirst) => {
      const chat = unified({
        id: 'chat-1',
        entityId: 'internal-handle',
        contentType: 'agent-session',
        structuredSessionId: 'internal-handle',
        aiVaultTitle: vaultTitle
      })
      const term = unified({ aiVaultTitle: vaultTitle })
      const items = buildSessionInventory(
        input({
          unifiedTabsByWorktree: { shared: structuredFirst ? [chat, term] : [term, chat] },
          tabsByWorktree: { shared: [terminal({ aiVaultTitle: vaultTitle })] }
        })
      )
      expect(items).toHaveLength(1)
      expect(items[0]).toMatchObject({
        key: 'shared|chat-1',
        kind: 'structured',
        unifiedTabId: 'chat-1',
        terminalTabId: null,
        providerSessionId: 'provider-1'
      })
    }
  )

  it('never merges the same provider token across execution owners or provider namespaces', () => {
    const source = input(
      {
        tabsByWorktree: Object.fromEntries(
          hosts.map((host) => [`${host}|shared`, [terminal({ aiVaultTitle: vaultTitle })]])
        )
      },
      hosts
    )
    expect(buildSessionInventory(source)).toHaveLength(3)
    expect(
      buildSessionInventory(
        input({
          tabsByWorktree: {
            shared: [
              terminal({ aiVaultTitle: vaultTitle }),
              terminal({
                id: 'terminal-2',
                launchAgent: 'codex',
                aiVaultTitle: { ...vaultTitle, agent: 'codex' }
              })
            ]
          }
        })
      )
    ).toHaveLength(2)
    expect(
      buildSessionInventory(
        input({
          tabsByWorktree: {
            shared: [terminal({ aiVaultTitle: vaultTitle })],
            'folder:notes': [terminal({ worktreeId: 'folder:notes', aiVaultTitle: vaultTitle })]
          }
        })
      )
    ).toHaveLength(2)
  })

  it('includes an agent started manually inside an existing ordinary terminal with an exact fresh provider hook', () => {
    const source = input({
      unifiedTabsByWorktree: { shared: [unified({ agentSessionAgent: undefined })] },
      tabsByWorktree: { shared: [terminal({ launchAgent: undefined })] },
      terminalLayoutsByTabId: currentLayouts,
      agentStatusByPaneKey: { live: providerHook() }
    })
    const items = buildSessionInventory(source)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      key: 'shared|unified-1',
      providerSessionId: 'provider-1',
      paneKey: providerHook().paneKey,
      agent: 'claude'
    })
    const matcher = createSessionHookMatcher(items, source.agentStatusByPaneKey)
    expect(
      projectSessionHookStatus(items[0], matcher(items[0]), 'connected', now).status.activity
    ).toBe('running')
  })

  it('does not manufacture a restorable session from a status record without any terminal tab', () => {
    expect(
      buildSessionInventory(
        input({
          terminalLayoutsByTabId: currentLayouts,
          agentStatusByPaneKey: { live: providerHook() }
        })
      )
    ).toEqual([])
  })

  it.each([
    { label: 'stale', patch: { evidenceObservedAt: now - AGENT_STATUS_STALE_AFTER_MS - 1 } },
    { label: 'future', patch: { evidenceObservedAt: now + 1 } },
    { label: 'restored', patch: { restoredUnconfirmed: true } },
    { label: 'missing provider', patch: { providerSession: undefined } },
    { label: 'nonterminal owner', patch: { terminalResumeEligible: false as const } },
    {
      label: 'removed leaf',
      patch: { paneKey: 'terminal-1:00000000-0000-4000-8000-000000000002' }
    },
    { label: 'conflicting tab', patch: { tabId: 'different' } },
    { label: 'other host', patch: { worktreeId: 'ssh:alpha|shared' } },
    {
      label: 'identity-only',
      patch: { observation: { ...hook().observation!, kind: 'identity-only' as const } }
    },
    {
      label: 'title inference',
      patch: { observation: { ...hook().observation!, origin: 'title' as const } }
    }
  ])('does not admit an ordinary shell from a $label hook', ({ patch }) => {
    expect(
      buildSessionInventory(
        input({
          tabsByWorktree: { shared: [terminal({ launchAgent: undefined })] },
          terminalLayoutsByTabId: currentLayouts,
          agentStatusByPaneKey: { live: providerHook(patch) }
        })
      )
    ).toEqual([])
  })

  it('does not accept an unqualified hook when multiple actual ordinary terminals share the tab id', () => {
    expect(
      buildSessionInventory(
        input(
          {
            tabsByWorktree: Object.fromEntries(
              hosts.map((host) => [`${host}|shared`, [terminal({ launchAgent: undefined })]])
            ),
            terminalLayoutsByTabId: currentLayouts,
            agentStatusByPaneKey: { live: providerHook({ worktreeId: 'shared' }) }
          },
          hosts
        )
      )
    ).toEqual([])
  })

  it('requires a resident layout before admitting a hook-backed ordinary terminal', () => {
    expect(
      buildSessionInventory(
        input({
          tabsByWorktree: { shared: [terminal({ launchAgent: undefined })] },
          agentStatusByPaneKey: { live: providerHook() }
        })
      )
    ).toEqual([])
  })

  it('retains ordinary shell owners as collision evidence after session filtering', () => {
    const projection = buildSessionInventoryProjection(
      input(
        {
          tabsByWorktree: {
            'local|shared': [terminal()],
            'ssh:alpha|shared': [terminal({ launchAgent: undefined })]
          },
          terminalLayoutsByTabId: currentLayouts,
          agentStatusByPaneKey: { live: providerHook({ worktreeId: 'shared' }) }
        },
        hosts
      )
    )
    expect(projection.items).toHaveLength(1)
    expect(projection.matchHook(projection.items[0])).toBeNull()
  })

  it.each([now - 10, now - AGENT_STATUS_STALE_AFTER_MS - 1])(
    'uses replica receipt time %s for remote provider freshness',
    (mirroredEvidenceReceivedAt) => {
      const items = buildSessionInventory(
        input(
          {
            tabsByWorktree: { 'ssh:alpha|shared': [terminal({ launchAgent: undefined })] },
            terminalLayoutsByTabId: currentLayouts,
            agentStatusByPaneKey: {
              live: providerHook({
                worktreeId: 'ssh:alpha|shared',
                evidenceObservedAt: now + 500_000,
                mirroredEvidenceReceivedAt
              })
            }
          },
          hosts
        )
      )
      expect(items).toHaveLength(mirroredEvidenceReceivedAt === now - 10 ? 1 : 0)
    }
  )

  it('does not choose between two current provider conversations in an ordinary split terminal', () => {
    const secondLeaf = '00000000-0000-4000-8000-000000000002'
    expect(
      buildSessionInventory(
        input({
          tabsByWorktree: { shared: [terminal({ launchAgent: undefined })] },
          terminalLayoutsByTabId: {
            'terminal-1': {
              ...currentLayouts['terminal-1'],
              root: {
                type: 'split',
                direction: 'vertical',
                first: { type: 'leaf', leafId },
                second: { type: 'leaf', leafId: secondLeaf }
              }
            }
          },
          agentStatusByPaneKey: {
            first: providerHook(),
            second: providerHook({
              paneKey: `terminal-1:${secondLeaf}`,
              providerSession: { key: 'session_id', id: 'provider-2' }
            })
          }
        })
      )
    ).toEqual([])
  })

  it('uses explicit vault agent metadata when launch metadata is absent', () => {
    const [item] = buildSessionInventory(
      input({
        tabsByWorktree: { shared: [terminal({ launchAgent: undefined, aiVaultTitle: vaultTitle })] }
      })
    )
    expect(item.agent).toBe('claude')
  })

  it.each(['provider-1', 'provider-2'])(
    'replaces old provider descriptions on a reused terminal with provider token %s while retaining its key',
    (providerSessionId) => {
      const base = input({
        unifiedTabsByWorktree: {
          shared: [
            unified({
              label: 'Current terminal',
              aiVaultTitle: vaultTitle,
              generatedLabel: 'Old generated conversation'
            })
          ]
        },
        tabsByWorktree: { shared: [terminal({ aiVaultTitle: vaultTitle })] },
        terminalLayoutsByTabId: currentLayouts
      })
      const [before] = buildSessionInventory(base)
      const changedHook = providerHook({
        agentType: 'codex',
        providerSession: { key: 'session_id', id: providerSessionId }
      })
      const source = { ...base, agentStatusByPaneKey: { current: changedHook } }
      const [after] = buildSessionInventory(source)
      expect(after).toMatchObject({
        key: before.key,
        providerSessionId,
        title: 'Current terminal',
        agent: 'codex',
        unifiedTabId: before.unifiedTabId,
        terminalTabId: before.terminalTabId
      })
      expect(findSessionHook(after, [after], source.agentStatusByPaneKey)).toBe(changedHook)
      expect(findSessionHook(before, [before], source.agentStatusByPaneKey)).toBeNull()
    }
  )

  it('keeps a user title when a proven new provider replaces cached conversation metadata', () => {
    const [item] = buildSessionInventory(
      input({
        tabsByWorktree: {
          shared: [terminal({ customTitle: 'My task', aiVaultTitle: vaultTitle })]
        },
        terminalLayoutsByTabId: currentLayouts,
        agentStatusByPaneKey: {
          current: providerHook({ providerSession: { key: 'session_id', id: 'provider-2' } })
        }
      })
    )
    expect(item).toMatchObject({
      title: 'My task',
      providerSessionId: 'provider-2',
      key: 'shared|terminal-1'
    })
  })

  it('does not replace provider identity from stale evidence and keeps its activity unknown on mismatch', () => {
    const source = input({
      tabsByWorktree: { shared: [terminal({ aiVaultTitle: vaultTitle })] },
      terminalLayoutsByTabId: currentLayouts,
      agentStatusByPaneKey: {
        old: providerHook({
          providerSession: { key: 'session_id', id: 'provider-2' },
          evidenceObservedAt: now - AGENT_STATUS_STALE_AFTER_MS - 1
        })
      }
    })
    const [item] = buildSessionInventory(source)
    expect(item).toMatchObject({ providerSessionId: 'provider-1', title: 'Cached conversation' })
    expect(findSessionHook(item, [item], source.agentStatusByPaneKey)).toBeNull()
  })
})
