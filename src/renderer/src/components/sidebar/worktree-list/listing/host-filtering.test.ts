import { describe, expect, it } from 'vitest'
import type { FolderWorkspace } from '../../../../../../shared/folder-workspace-types'
import type { ProjectGroup } from '../../../../../../shared/project-group-types'
import {
  getFolderPathStatusRouteOptionsForRows,
  filterFolderWorkspacesForVisibleHosts,
  getFolderWorkspaceExecutionHostIdForRows,
  getProjectGroupExecutionHostIdForRows,
  getRuntimeEnvironmentIdForFolderPathStatusHost
} from './host-filtering'

function group(overrides: Partial<ProjectGroup> = {}): ProjectGroup {
  return {
    id: 'group-1',
    name: 'Runtime group',
    parentPath: '/srv/app',
    connectionId: null,
    executionHostId: null,
    parentGroupId: null,
    createdFrom: 'folder-scan',
    tabOrder: 0,
    isCollapsed: false,
    color: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  }
}

function folderWorkspace(overrides: Partial<FolderWorkspace> = {}): FolderWorkspace {
  return {
    id: 'folder-1',
    projectGroupId: 'group-1',
    name: 'Runtime folder',
    folderPath: '/srv/app/task',
    connectionId: null,
    linkedTask: null,
    comment: '',
    isArchived: false,
    isUnread: false,
    isPinned: false,
    sortOrder: 0,
    lastActivityAt: 1,
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  }
}

describe('WorktreeList host filtering ownership', () => {
  it('uses runtime execution host stamps before SSH/default fallbacks for project groups', () => {
    expect(
      getProjectGroupExecutionHostIdForRows(
        group({ connectionId: 'ssh-builder', executionHostId: 'runtime:env-1' }),
        'local'
      )
    ).toBe('runtime:env-1')
  })

  it('uses the project group runtime owner for folder workspaces in that group', () => {
    expect(
      getFolderWorkspaceExecutionHostIdForRows({
        folderWorkspace: folderWorkspace({ connectionId: 'ssh-builder' }),
        projectGroup: group({ connectionId: 'ssh-builder', executionHostId: 'runtime:env-1' }),
        defaultHostId: 'local'
      })
    ).toBe('runtime:env-1')
  })

  it('keeps explicit runtime group ownership when the focused runtime is the same host', () => {
    expect(
      getFolderWorkspaceExecutionHostIdForRows({
        folderWorkspace: folderWorkspace({ connectionId: 'ssh-builder' }),
        projectGroup: group({ connectionId: 'ssh-builder', executionHostId: 'runtime:env-1' }),
        defaultHostId: 'runtime:env-1'
      })
    ).toBe('runtime:env-1')
  })

  it('extracts runtime route ids for folder path status requests', () => {
    expect(getRuntimeEnvironmentIdForFolderPathStatusHost('runtime:env-1')).toBe('env-1')
    expect(getRuntimeEnvironmentIdForFolderPathStatusHost('ssh:ssh-builder')).toBeNull()
    expect(getRuntimeEnvironmentIdForFolderPathStatusHost('local')).toBeNull()
  })

  it('keeps same-ID local workspaces visible when a remote group follows them', () => {
    const local = folderWorkspace()
    const remote = folderWorkspace({ executionHostId: 'runtime:env-1' })
    const groups = [group(), group({ executionHostId: 'runtime:env-1' })]
    expect(
      filterFolderWorkspacesForVisibleHosts([local, remote], groups, new Set(['local']), 'local')
    ).toEqual([local])
    expect(
      filterFolderWorkspacesForVisibleHosts(
        [local, remote],
        groups,
        new Set(['runtime:env-1']),
        'local'
      )
    ).toEqual([remote])
  })

  it('routes path-status requests using the explicit row owner rather than the focused Runtime', () => {
    expect(getFolderPathStatusRouteOptionsForRows('local')).toEqual({ runtimeEnvironmentId: null })
    expect(getFolderPathStatusRouteOptionsForRows('ssh:builder')).toEqual({
      runtimeEnvironmentId: null
    })
    expect(getFolderPathStatusRouteOptionsForRows('runtime:env-1')).toEqual({
      runtimeEnvironmentId: 'env-1'
    })
  })
})
