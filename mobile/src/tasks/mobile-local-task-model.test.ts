import { describe, expect, it } from 'vitest'
import {
  mobileLocalTaskSourceLabel,
  projectMobileLocalTaskGroups,
  type MobileLocalAgentStatus,
  type MobileLocalSessionSnapshot
} from './mobile-local-task-model'
import {
  parseMobileLocalSessionInventory,
  parseMobileLocalWorktreeMetadata
} from './mobile-local-task-rpc'
import {
  applyMobileLocalSessionUpdate,
  mergeMobileLocalSessionInventory
} from './mobile-local-task-snapshots'

function status(
  paneKey: string,
  state: MobileLocalAgentStatus['state'],
  overrides: Partial<MobileLocalAgentStatus> = {}
): MobileLocalAgentStatus {
  return {
    state,
    prompt: `Prompt ${paneKey}`,
    updatedAt: 10_000,
    stateStartedAt: 9_000,
    paneKey,
    agentType: 'codex',
    stateHistory: [],
    ...overrides
  }
}

function snapshot(
  worktreeId: string,
  statuses: MobileLocalAgentStatus[],
  snapshotVersion = 1
): MobileLocalSessionSnapshot {
  return {
    worktreeId,
    publicationEpoch: 'epoch-1',
    snapshotVersion,
    tabs: statuses.map((agentStatus, index) => ({
      id: `terminal-${index}`,
      tabId: `tab-${index}`,
      title: `Terminal ${index}`,
      agentStatus
    }))
  }
}

describe('mobile local task RPC parsing', () => {
  it('admits only terminal tabs carrying a structurally valid real agentStatus', () => {
    const inventory = parseMobileLocalSessionInventory({
      authoritative: true,
      snapshots: [
        {
          worktree: 'wt-1',
          publicationEpoch: 'epoch-1',
          snapshotVersion: 4,
          tabs: [
            {
              type: 'terminal',
              id: 'terminal-1',
              parentTabId: 'tab-1',
              title: 'Agent terminal',
              agentStatus: {
                state: 'working',
                prompt: 'Ship the task center',
                updatedAt: 2_000,
                stateStartedAt: 1_000,
                paneKey: 'tab-1:leaf-1',
                agentType: 'codex',
                stateHistory: []
              }
            },
            {
              type: 'terminal',
              id: 'terminal-without-agent',
              parentTabId: 'tab-2',
              title: 'Shell'
            },
            {
              type: 'terminal',
              id: 'terminal-with-invalid-agent',
              parentTabId: 'tab-3',
              title: 'Broken',
              agentStatus: { state: 'working', paneKey: '' }
            },
            {
              type: 'markdown',
              id: 'markdown-1',
              title: 'Notes',
              agentStatus: {
                state: 'working',
                updatedAt: 2_000,
                stateStartedAt: 1_000,
                paneKey: 'fake-pane'
              }
            }
          ]
        },
        { worktree: '', tabs: [] }
      ]
    })

    expect(inventory.authoritative).toBe(false)
    expect(inventory.snapshots).toHaveLength(1)
    expect(inventory.snapshots[0]?.tabs).toHaveLength(1)
    expect(inventory.snapshots[0]?.tabs[0]).toMatchObject({
      id: 'terminal-1',
      tabId: 'tab-1',
      agentStatus: { paneKey: 'tab-1:leaf-1', state: 'working' }
    })
  })

  it('parses only worktree.ps metadata needed by the presentation', () => {
    expect(
      parseMobileLocalWorktreeMetadata({
        worktrees: [
          {
            worktreeId: 'wt-1',
            repo: 'hive-code-next',
            branch: 'mobile-task-center',
            displayName: 'Task center',
            linkedLinearIssue: 'HIVE-42',
            agents: [
              {
                paneKey: 'tab-1:leaf-1',
                displayName: 'Mobile worker',
                taskTitle: 'Implement local task list',
                agentType: 'codex'
              },
              { paneKey: '' }
            ]
          },
          { repo: 'missing-id' }
        ]
      })
    ).toEqual([
      {
        worktreeId: 'wt-1',
        repo: 'hive-code-next',
        branch: 'mobile-task-center',
        displayName: 'Task center',
        source: 'linear',
        agents: [
          {
            paneKey: 'tab-1:leaf-1',
            displayName: 'Mobile worker',
            taskTitle: 'Implement local task list',
            agentType: 'codex'
          }
        ]
      }
    ])
  })
})

describe('mobile local task grouping', () => {
  it('keeps every real execution source explicit for the unified task view', () => {
    expect(
      (['local', 'github', 'gitlab', 'linear'] as const).map(mobileLocalTaskSourceLabel)
    ).toEqual(['本地', 'GitHub', 'GitLab', 'Linear'])
  })

  it('groups active states and joins metadata by both worktreeId and paneKey', () => {
    const groups = projectMobileLocalTaskGroups({
      snapshots: [
        snapshot('wt-1', [
          status('pane-working', 'working', { updatedAt: 12_000 }),
          status('pane-blocked', 'blocked', { updatedAt: 11_000 }),
          status('pane-waiting', 'waiting', { updatedAt: 10_000 })
        ])
      ],
      worktrees: [
        {
          worktreeId: 'wt-1',
          repo: 'hive-code-next',
          branch: 'mobile-ui',
          displayName: 'Mobile UI',
          source: 'github',
          agents: [
            {
              paneKey: 'other-pane',
              displayName: 'Wrong agent',
              taskTitle: 'Wrong task',
              agentType: 'claude'
            },
            {
              paneKey: 'pane-working',
              displayName: 'Task worker',
              taskTitle: 'Build the real local list',
              agentType: 'codex'
            }
          ]
        }
      ],
      sourceVerifiable: true
    })

    expect(groups.inProgress.map((row) => row.state)).toEqual(['working', 'blocked', 'waiting'])
    expect(groups.inProgress[0]).toMatchObject({
      title: 'Build the real local list',
      agentDisplayName: 'Task worker',
      repo: 'hive-code-next',
      branch: 'mobile-ui',
      source: 'github',
      verifiable: true
    })
    expect(groups.inProgress[1]?.agentDisplayName).not.toBe('Wrong agent')
  })

  it('uses the canonical completion clock, excludes interrupted and missing completions, then sorts and limits', () => {
    const groups = projectMobileLocalTaskGroups({
      snapshots: [
        snapshot('wt-1', [
          status('done-older', 'done', { stateStartedAt: 4_000, updatedAt: 4_100 }),
          status('done-newer-boundary', 'done', {
            prompt: '',
            stateStartedAt: 9_000,
            updatedAt: 9_100,
            sessionBoundary: true,
            stateHistory: [
              { state: 'done', prompt: 'Completed real turn', startedAt: 8_000 },
              { state: 'working', prompt: 'Later boundary', startedAt: 8_500 }
            ]
          }),
          status('done-interrupted', 'done', {
            stateStartedAt: 10_000,
            interrupted: true
          }),
          status('done-without-real-time', 'done', { stateStartedAt: 0 }),
          status('boundary-without-history', 'done', {
            stateStartedAt: 12_000,
            sessionBoundary: true
          })
        ])
      ],
      worktrees: [],
      sourceVerifiable: true,
      recentLimit: 1
    })

    expect(groups.recentCompleted).toHaveLength(1)
    expect(groups.recentCompleted[0]).toMatchObject({
      paneKey: 'done-newer-boundary',
      completionAt: 8_000,
      statusAt: 8_000,
      title: 'Completed real turn'
    })
  })

  it('marks restored or disconnected rows unverifiable without changing their lifecycle state', () => {
    const restored = projectMobileLocalTaskGroups({
      snapshots: [snapshot('wt-1', [status('pane-1', 'waiting', { restoredUnconfirmed: true })])],
      worktrees: [],
      sourceVerifiable: true
    })
    const disconnected = projectMobileLocalTaskGroups({
      snapshots: [snapshot('wt-1', [status('pane-1', 'waiting')])],
      worktrees: [],
      sourceVerifiable: false
    })

    expect(restored.inProgress[0]).toMatchObject({ state: 'waiting', verifiable: false })
    expect(disconnected.inProgress[0]).toMatchObject({ state: 'waiting', verifiable: false })
  })
})

describe('mobile local session snapshot reconciliation', () => {
  it('ignores stale updates and preserves a retained row across an unpublished placeholder', () => {
    const current = [snapshot('wt-1', [status('pane-current', 'working')], 3)]
    const stale = {
      ...snapshot('wt-1', [], 2),
      removed: false
    }
    expect(applyMobileLocalSessionUpdate(current, stale)).toEqual(current)
    expect(
      mergeMobileLocalSessionInventory(current, {
        authoritative: true,
        snapshots: [snapshot('wt-1', [], 2)]
      })
    ).toEqual(current)

    expect(
      mergeMobileLocalSessionInventory(current, {
        authoritative: true,
        snapshots: [
          {
            worktreeId: 'wt-1',
            publicationEpoch: 'none',
            snapshotVersion: 0,
            tabs: []
          }
        ]
      })
    ).toEqual(current)

    expect(
      mergeMobileLocalSessionInventory(current, { authoritative: true, snapshots: [] })
    ).toEqual([])
  })
})
