import { describe, expect, it } from 'vitest'
import type { Worktree } from './workspace-list-types'
import { projectMobileWorkspaceSummary } from './mobile-workspace-summary'

function worktree(overrides: Partial<Worktree> = {}): Worktree {
  return {
    branch: 'main',
    displayName: 'workspace',
    hasAttachedPty: false,
    isPinned: false,
    linkedPR: null,
    liveTerminalCount: 0,
    path: '/workspace',
    preview: '',
    repo: 'repo',
    repoId: 'repo',
    unread: false,
    worktreeId: 'workspace',
    ...overrides
  }
}

describe('mobile workspace summary', () => {
  it('counts fresh running and attention agent states from runtime data', () => {
    const now = 1_000_000
    const summary = projectMobileWorkspaceSummary(
      [
        worktree({
          agents: [
            {
              state: 'working',
              workingMode: 'working',
              interrupted: false,
              updatedAt: now,
              prompt: ''
            },
            {
              state: 'waiting',
              workingMode: 'working',
              interrupted: false,
              updatedAt: now,
              prompt: ''
            }
          ] as Worktree['agents']
        }),
        worktree({ worktreeId: 'permission', status: 'permission' })
      ],
      true,
      now
    )

    expect(summary).toEqual({ workspaceCount: '2', runningAgentCount: '1', attentionCount: '2' })
  })

  it('does not present cached agent state as live after runtime contact is lost', () => {
    const summary = projectMobileWorkspaceSummary(
      [worktree({ status: 'working' })],
      false,
      1_000_000
    )

    expect(summary).toEqual({ workspaceCount: '1', runningAgentCount: '—', attentionCount: '—' })
  })
})
