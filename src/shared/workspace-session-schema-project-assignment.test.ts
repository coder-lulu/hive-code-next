import { describe, it, expect } from 'vitest'
import { parseWorkspaceSession } from './workspace-session-schema'

describe('retained product contract', () => {
  it('preserves valid session project assignments and salvages an invalid optional assignment', () => {
    const parse = (projectId: string) =>
      parseWorkspaceSession({
        activeRepoId: null,
        activeWorktreeId: 'global-floating-terminal',
        activeTabId: 'tab-1',
        tabsByWorktree: {
          'global-floating-terminal': [
            {
              id: 'tab-1',
              ptyId: null,
              worktreeId: 'global-floating-terminal',
              title: 'Codex',
              customTitle: null,
              color: null,
              sortOrder: 0,
              createdAt: 1,
              projectAssignment: {
                projectId,
                projectIdentityKey: 'local|project:project-1',
                projectGroupId: 'space-1',
                executionHostId: 'local',
                assignedAt: 2
              }
            }
          ]
        },
        terminalLayoutsByTabId: {}
      })

    const valid = parse('project-1')
    expect(valid.ok).toBe(true)
    if (valid.ok) {
      expect(
        valid.value.tabsByWorktree['global-floating-terminal']?.[0]?.projectAssignment
      ).toEqual({
        projectId: 'project-1',
        projectIdentityKey: 'local|project:project-1',
        projectGroupId: 'space-1',
        executionHostId: 'local',
        assignedAt: 2
      })
    }

    const invalid = parse('')
    expect(invalid.ok).toBe(true)
    if (invalid.ok) {
      expect(
        invalid.value.tabsByWorktree['global-floating-terminal']?.[0]?.projectAssignment
      ).toBeUndefined()
    }
  })
})
