import { describe, expect, it } from 'vitest'
import {
  buildDesktopHomeModel,
  findDesktopHomeWorkspace,
  formatHomeRelativeTime
} from './desktop-home-model'
import { APP_DISPLAY_NAME } from '../../product-brand'
import { getProjectGroupHeaderKey } from '../sidebar/worktree-list/grouping/group-keys'

describe('buildDesktopHomeModel', () => {
  it('sorts real workspaces by activity and projects the active context', () => {
    const model = buildDesktopHomeModel({
      repos: [{ id: 'repo-1', displayName: APP_DISPLAY_NAME, path: '/code' }],
      worktreesByRepo: {
        'repo-1': [
          {
            id: 'older',
            repoId: 'repo-1',
            displayName: 'main',
            path: '/code',
            branch: 'refs/heads/main',
            isMainWorktree: true,
            lastActivityAt: 10
          },
          {
            id: 'newer',
            repoId: 'repo-1',
            displayName: 'desktop-home',
            path: '/code/desktop-home',
            branch: 'feature/desktop-home',
            hostId: 'runtime:cloud-1',
            lastActivityAt: 20
          }
        ]
      },
      tabsByWorktree: { newer: [{ id: 'tab-1' }, { id: 'tab-2' }] },
      openFiles: [
        { id: 'a', worktreeId: 'newer', relativePath: 'src/App.tsx' },
        { id: 'b', worktreeId: 'older', relativePath: 'README.md' }
      ]
    })

    expect(model.currentWorkspace).toMatchObject({
      id: 'newer',
      branch: 'feature/desktop-home',
      hostLabel: 'cloud',
      sessionCount: 2
    })
    expect(model.currentFiles.map((file) => file.relativePath)).toEqual(['src/App.tsx'])
    expect(model.projectCount).toBe(1)
    expect(model.workspaceCount).toBe(2)
  })

  it('keeps the freshest duplicate workspace without duplicating its project membership', () => {
    const model = buildDesktopHomeModel({
      repos: [{ id: 'repo-1', displayName: 'Project', path: '/code' }],
      worktreesByRepo: {
        'repo-1': [
          {
            id: 'shared-worktree',
            repoId: 'repo-1',
            displayName: 'stale',
            path: '/code',
            lastActivityAt: 1
          },
          {
            id: 'shared-worktree',
            repoId: 'repo-1',
            displayName: 'fresh',
            path: '/code',
            lastActivityAt: 2
          }
        ]
      },
      tabsByWorktree: {},
      openFiles: []
    })

    expect(model.workspaces).toHaveLength(1)
    expect(model.workspaces[0]).toMatchObject({ name: 'fresh', lastActivityAt: 2 })
    expect(model.projects).toHaveLength(1)
    expect(model.projects[0]).toMatchObject({ workspaceCount: 1 })
    expect(model.projects[0].workspaces).toEqual([model.workspaces[0]])
  })

  it('does not invent context for an empty account', () => {
    expect(
      buildDesktopHomeModel({ repos: [], worktreesByRepo: {}, tabsByWorktree: {}, openFiles: [] })
    ).toEqual({
      recentWorkspaces: [],
      currentWorkspace: null,
      currentFiles: [],
      projectCount: 0,
      workspaceCount: 0
    })
  })

  it('prefers the scoped active workspace key over the legacy worktree id', () => {
    const model = buildDesktopHomeModel({
      repos: [{ id: 'repo-1', displayName: 'Project', path: '/code' }],
      worktreesByRepo: {
        'repo-1': [
          {
            id: 'worktree-1',
            repoId: 'repo-1',
            displayName: 'main',
            path: '/code',
            isMainWorktree: true,
            lastActivityAt: 10
          }
        ]
      },
      folderWorkspaces: [
        {
          id: 'folder-1',
          projectGroupId: 'group-1',
          name: 'Docs',
          folderPath: '/docs',
          lastActivityAt: 20
        }
      ],
      projectGroups: [{ id: 'group-1', name: 'Group', parentGroupId: null, tabOrder: 0 }],
      tabsByWorktree: {},
      openFiles: [],
      activeWorkspaceKey: 'folder:folder-1',
      activeWorktreeId: 'worktree-1'
    })

    expect(model.currentWorkspace).toMatchObject({
      id: 'folder-1',
      workspaceKey: 'folder:folder-1',
      kind: 'folder'
    })
  })

  it('builds nested groups and resolves collapse state from the sidebar set', () => {
    const model = buildDesktopHomeModel({
      repos: [
        {
          id: 'repo-child',
          displayName: 'Child project',
          path: '/child',
          projectGroupId: 'child'
        }
      ],
      worktreesByRepo: {
        'repo-child': [
          { id: 'wt-child', repoId: 'repo-child', displayName: 'main', path: '/child' }
        ]
      },
      tabsByWorktree: {},
      openFiles: [],
      projectGroups: [
        // Persisted isCollapsed is intentionally ignored by the projection.
        { id: 'root', name: 'Root', parentGroupId: null, tabOrder: 0, isCollapsed: true },
        { id: 'child', name: 'Child', parentGroupId: 'root', tabOrder: 0, isCollapsed: false }
      ],
      collapsedGroups: new Set([getProjectGroupHeaderKey('child')])
    })

    expect(model.groups).toHaveLength(1)
    expect(model.groups[0]).toMatchObject({ id: 'root', isCollapsed: false })
    expect(model.groups[0].childGroups[0]).toMatchObject({
      id: 'child',
      isCollapsed: true,
      workspaceCount: 1
    })
    expect(model.groups[0].childGroups[0].projects.map((project) => project.id)).toEqual([
      'repo-child'
    ])
  })

  it('renders folder workspaces as direct group rows and excludes archived entries', () => {
    const model = buildDesktopHomeModel({
      repos: [
        { id: 'repo-1', displayName: 'Project', path: '/project', projectGroupId: 'group-1' }
      ],
      worktreesByRepo: {
        'repo-1': [
          { id: 'active', repoId: 'repo-1', displayName: 'main', path: '/project' },
          {
            id: 'archived-worktree',
            repoId: 'repo-1',
            displayName: 'old',
            path: '/project-old',
            isArchived: true
          }
        ]
      },
      folderWorkspaces: [
        {
          id: 'folder-active',
          projectGroupId: 'group-1',
          name: 'Design files',
          folderPath: '/design',
          lastActivityAt: 10
        },
        {
          id: 'folder-archived',
          projectGroupId: 'group-1',
          name: 'Old files',
          folderPath: '/old-design',
          isArchived: true
        }
      ],
      projectGroups: [{ id: 'group-1', name: 'Group', parentGroupId: null, tabOrder: 0 }],
      tabsByWorktree: {},
      openFiles: []
    })

    const group = model.groups[0]
    expect(group.folderWorkspaces.map((workspace) => workspace.id)).toEqual(['folder-active'])
    expect(group.projects[0].workspaces.map((workspace) => workspace.id)).toEqual(['active'])
    expect(model.workspaces.some((workspace) => workspace.id === 'archived-worktree')).toBe(false)
    expect(model.workspaces.some((workspace) => workspace.id === 'folder-archived')).toBe(false)
  })

  it('keeps host-qualified identities when worktree ids overlap across hosts', () => {
    const model = buildDesktopHomeModel({
      repos: [
        {
          id: 'repo-shared',
          displayName: 'Cloud A',
          path: '/cloud-a',
          executionHostId: 'runtime:cloud-a'
        },
        {
          id: 'repo-shared',
          displayName: 'Cloud B',
          path: '/cloud-b',
          executionHostId: 'runtime:cloud-b'
        }
      ],
      worktreesByRepo: {
        'repo-shared': [
          {
            id: 'same-id',
            repoId: 'repo-shared',
            displayName: 'workspace A',
            path: '/cloud-a',
            hostId: 'runtime:cloud-a'
          },
          {
            id: 'same-id',
            repoId: 'repo-shared',
            displayName: 'workspace B',
            path: '/cloud-b',
            hostId: 'runtime:cloud-b'
          }
        ]
      },
      tabsByWorktree: {},
      openFiles: []
    })

    expect(model.workspaces).toHaveLength(2)
    expect(new Set(model.workspaces.map((workspace) => workspace.identityKey))).toEqual(
      new Set(['runtime:cloud-a|same-id', 'runtime:cloud-b|same-id'])
    )
  })

  it('keeps session summaries addressable when hosts share workspace and session ids', () => {
    const model = buildDesktopHomeModel({
      repos: [
        { id: 'repo-a', displayName: 'Cloud A', path: '/cloud-a', executionHostId: 'runtime:a' },
        { id: 'repo-b', displayName: 'Cloud B', path: '/cloud-b', executionHostId: 'runtime:b' }
      ],
      worktreesByRepo: {
        'repo-a': [
          {
            id: 'same-id',
            repoId: 'repo-a',
            displayName: 'A',
            path: '/cloud-a',
            hostId: 'runtime:a'
          }
        ],
        'repo-b': [
          {
            id: 'same-id',
            repoId: 'repo-b',
            displayName: 'B',
            path: '/cloud-b',
            hostId: 'runtime:b'
          }
        ]
      },
      unifiedTabsByWorktree: {
        'runtime:a|same-id': [
          {
            id: 'tab-a',
            contentType: 'agent-session',
            structuredSessionId: 'session-shared',
            label: 'A session'
          }
        ],
        'runtime:b|same-id': [
          {
            id: 'tab-b',
            contentType: 'agent-session',
            structuredSessionId: 'session-shared',
            label: 'B session'
          }
        ]
      },
      tabsByWorktree: {},
      openFiles: []
    })

    expect(model.sessionSummaries).toHaveLength(2)
    expect(new Set(model.sessionSummaries.map((session) => session.workspaceIdentityKey))).toEqual(
      new Set(['runtime:a|same-id', 'runtime:b|same-id'])
    )
  })

  it('does not leave an empty local project beside a host-owned workspace', () => {
    const model = buildDesktopHomeModel({
      repos: [{ id: 'repo-1', displayName: 'Remote project', path: '/remote' }],
      worktreesByRepo: {
        'repo-1': [
          {
            id: 'remote-worktree',
            repoId: 'repo-1',
            displayName: 'main',
            path: '/remote',
            hostId: 'runtime:cloud-1'
          }
        ]
      },
      tabsByWorktree: {},
      openFiles: []
    })

    expect(model.projects).toHaveLength(1)
    expect(model.projects[0]).toMatchObject({
      identityKey: 'runtime:cloud-1|project:repo-1',
      workspaceCount: 1
    })
  })

  it('keeps an empty same-id project visible on a second execution host', () => {
    const model = buildDesktopHomeModel({
      repos: [
        {
          id: 'repo-shared',
          displayName: 'Local copy',
          path: '/local',
          executionHostId: 'local'
        },
        {
          id: 'repo-shared',
          displayName: 'Cloud copy',
          path: '/cloud',
          executionHostId: 'runtime:cloud-1'
        }
      ],
      worktreesByRepo: {
        'repo-shared': [
          {
            id: 'cloud-main',
            repoId: 'repo-shared',
            displayName: 'main',
            path: '/cloud',
            hostId: 'runtime:cloud-1'
          }
        ]
      },
      tabsByWorktree: {},
      openFiles: []
    })

    expect(model.projects.map((project) => project.identityKey)).toEqual([
      'runtime:cloud-1|project:repo-shared',
      'local|project:repo-shared'
    ])
    expect(model.projects.find((project) => project.executionHostId === 'local')).toMatchObject({
      workspaceCount: 0
    })
  })

  it('does not assign bare legacy tabs or files to every host-colliding workspace', () => {
    const model = buildDesktopHomeModel({
      repos: [
        {
          id: 'repo-a',
          displayName: 'Cloud A',
          path: '/cloud-a',
          executionHostId: 'runtime:cloud-a'
        },
        {
          id: 'repo-b',
          displayName: 'Cloud B',
          path: '/cloud-b',
          executionHostId: 'runtime:cloud-b'
        }
      ],
      worktreesByRepo: {
        'repo-a': [
          {
            id: 'same-id',
            repoId: 'repo-a',
            displayName: 'workspace A',
            path: '/cloud-a',
            hostId: 'runtime:cloud-a'
          }
        ],
        'repo-b': [
          {
            id: 'same-id',
            repoId: 'repo-b',
            displayName: 'workspace B',
            path: '/cloud-b',
            hostId: 'runtime:cloud-b'
          }
        ]
      },
      // A pre-host-qualified snapshot cannot tell which runtime owns this tab.
      tabsByWorktree: {
        'same-id': [{ id: 'legacy-agent', contentType: 'agent-session', label: 'Ambiguous' }]
      },
      openFiles: [{ id: 'legacy-file', worktreeId: 'same-id', relativePath: 'README.md' }],
      activeWorkspaceKey: 'worktree:same-id',
      activeWorkspaceExecutionHostId: 'runtime:cloud-a'
    })

    expect(model.workspaces.every((workspace) => workspace.sessions.length === 0)).toBe(true)
    expect(model.currentFiles).toEqual([])
  })

  it('matches host-qualified files for the selected workspace', () => {
    const model = buildDesktopHomeModel({
      repos: [
        {
          id: 'repo-a',
          displayName: 'Cloud A',
          path: '/cloud-a',
          executionHostId: 'runtime:cloud-a'
        },
        {
          id: 'repo-b',
          displayName: 'Cloud B',
          path: '/cloud-b',
          executionHostId: 'runtime:cloud-b'
        }
      ],
      worktreesByRepo: {
        'repo-a': [
          {
            id: 'same-id',
            repoId: 'repo-a',
            displayName: 'A',
            path: '/cloud-a',
            hostId: 'runtime:cloud-a'
          }
        ],
        'repo-b': [
          {
            id: 'same-id',
            repoId: 'repo-b',
            displayName: 'B',
            path: '/cloud-b',
            hostId: 'runtime:cloud-b'
          }
        ]
      },
      tabsByWorktree: {},
      openFiles: [
        {
          id: 'file-a',
          worktreeId: 'same-id',
          executionHostId: 'runtime:cloud-a',
          relativePath: 'src/a.ts'
        },
        {
          id: 'file-b',
          worktreeId: 'same-id',
          executionHostId: 'runtime:cloud-b',
          relativePath: 'src/b.ts'
        }
      ],
      activeWorkspaceKey: 'worktree:same-id',
      activeWorkspaceExecutionHostId: 'runtime:cloud-b'
    })

    expect(model.currentFiles.map((file) => file.relativePath)).toEqual(['src/b.ts'])
  })

  it('requires a host-qualified locator when a canonical workspace key is ambiguous', () => {
    const model = buildDesktopHomeModel({
      repos: [
        { id: 'repo-a', displayName: 'A', path: '/a', executionHostId: 'runtime:a' },
        { id: 'repo-b', displayName: 'B', path: '/b', executionHostId: 'runtime:b' }
      ],
      worktreesByRepo: {
        'repo-a': [
          { id: 'same', repoId: 'repo-a', displayName: 'A', path: '/a', hostId: 'runtime:a' }
        ],
        'repo-b': [
          { id: 'same', repoId: 'repo-b', displayName: 'B', path: '/b', hostId: 'runtime:b' }
        ]
      },
      tabsByWorktree: {},
      openFiles: []
    })

    expect(findDesktopHomeWorkspace(model, 'worktree:same')).toBeNull()
    expect(findDesktopHomeWorkspace(model, 'worktree:same', 'runtime:b')).toMatchObject({
      executionHostId: 'runtime:b'
    })
  })

  it('enriches one project row with host setup metadata without duplicating it', () => {
    const model = buildDesktopHomeModel({
      repos: [{ id: 'repo-1', displayName: 'Project', path: '/project' }],
      worktreesByRepo: { 'repo-1': [] },
      tabsByWorktree: {},
      openFiles: [],
      projects: [{ id: 'project-1', displayName: 'Project', sourceRepoIds: ['repo-1'] }],
      projectHostSetups: [
        {
          id: 'setup-1',
          projectId: 'project-1',
          repoId: 'repo-1',
          hostId: 'local',
          setupMethod: 'cloned',
          kind: 'git',
          setupState: 'ready'
        }
      ]
    })

    expect(model.projects).toHaveLength(1)
    expect(model.projects[0]).toMatchObject({
      id: 'project-1',
      setupState: 'ready',
      hostSetups: [{ id: 'setup-1', repoId: 'repo-1', executionHostId: 'local' }]
    })
  })

  it('keeps all repositories of one logical project in a single space project row', () => {
    const model = buildDesktopHomeModel({
      repos: [
        { id: 'repo-a', displayName: 'API', path: '/api', projectGroupId: 'space-1' },
        { id: 'repo-b', displayName: 'Web', path: '/web', projectGroupId: 'space-1' }
      ],
      worktreesByRepo: {
        'repo-a': [{ id: 'wt-api', repoId: 'repo-a', displayName: 'main', path: '/api' }],
        'repo-b': [{ id: 'wt-web', repoId: 'repo-b', displayName: 'main', path: '/web' }]
      },
      tabsByWorktree: {},
      openFiles: [],
      projects: [
        { id: 'project-platform', displayName: 'Platform', sourceRepoIds: ['repo-a', 'repo-b'] }
      ],
      projectGroups: [{ id: 'space-1', name: 'Platform space', parentGroupId: null, tabOrder: 0 }]
    })

    expect(model.projects).toHaveLength(1)
    expect(model.projects[0]).toMatchObject({
      id: 'project-platform',
      repoIds: ['repo-a', 'repo-b'],
      workspaceCount: 2,
      projectGroupId: 'space-1'
    })
    expect(model.groups[0].projects[0].workspaces.map((workspace) => workspace.repoId)).toEqual([
      'repo-a',
      'repo-b'
    ])
  })

  it('does not attach a remote project to an explicitly local group', () => {
    const model = buildDesktopHomeModel({
      repos: [
        {
          id: 'repo-remote',
          displayName: 'Remote',
          path: '/remote',
          projectGroupId: 'group-1',
          executionHostId: 'runtime:cloud-1'
        }
      ],
      worktreesByRepo: {
        'repo-remote': [
          {
            id: 'wt-remote',
            repoId: 'repo-remote',
            displayName: 'main',
            path: '/remote',
            hostId: 'runtime:cloud-1'
          }
        ]
      },
      tabsByWorktree: {},
      openFiles: [],
      projectGroups: [
        {
          id: 'group-1',
          name: 'Local group',
          parentGroupId: null,
          tabOrder: 0,
          executionHostId: 'local'
        }
      ]
    })

    expect(model.groups[0].projects).toHaveLength(0)
    expect(model.ungrouped.projects.map((project) => project.name)).toEqual(['Remote'])
  })

  it('keeps only stable agent sessions in session summaries', () => {
    const model = buildDesktopHomeModel({
      repos: [{ id: 'repo-1', displayName: 'Project', path: '/code' }],
      worktreesByRepo: {
        'repo-1': [{ id: 'worktree-1', repoId: 'repo-1', displayName: 'main', path: '/code' }]
      },
      tabsByWorktree: {
        'worktree-1': [
          { id: 'bare-tab', label: 'README.md', contentType: 'editor' },
          {
            id: 'agent-tab',
            label: 'Implement feature',
            contentType: 'agent-session',
            lastFocusedAt: 30
          },
          {
            id: 'structured-tab',
            label: 'Review',
            structuredSessionId: 'session-1',
            lastFocusedAt: 20
          }
        ]
      },
      openFiles: []
    })

    expect(model.sessionSummaries.map((session) => session.id)).toEqual(['agent-tab', 'session-1'])
    expect(model.workspaces[0].sessions).toHaveLength(2)
    expect(model.workspaces[0].sessions.some((session) => session.id === 'bare-tab')).toBe(false)
  })

  it('projects agent sessions from the unified tab snapshot without duplicating legacy tabs', () => {
    const model = buildDesktopHomeModel({
      repos: [{ id: 'repo-1', displayName: 'Project', path: '/code' }],
      worktreesByRepo: {
        'repo-1': [{ id: 'wt-1', repoId: 'repo-1', displayName: 'main', path: '/code' }]
      },
      tabsByWorktree: {
        'wt-1': [{ id: 'agent-1', label: 'legacy title', contentType: 'terminal' }]
      },
      unifiedTabsByWorktree: {
        'wt-1': [
          {
            id: 'agent-1',
            label: 'Unified agent title',
            contentType: 'agent-session',
            structuredSessionId: 'session-1',
            createdAt: 20
          }
        ]
      },
      openFiles: []
    })

    expect(model.sessionSummaries).toMatchObject([
      { id: 'session-1', title: 'Unified agent title', restoreTabId: 'agent-1' }
    ])
    expect(model.workspaces[0].sessions).toHaveLength(1)
  })

  it('keeps floating agent sessions in the temporary bucket instead of a workspace', () => {
    const model = buildDesktopHomeModel({
      repos: [{ id: 'repo-1', displayName: 'Project', path: '/code' }],
      worktreesByRepo: {
        'repo-1': [{ id: 'wt-1', repoId: 'repo-1', displayName: 'main', path: '/code' }]
      },
      unifiedTabsByWorktree: {
        'global-floating-terminal': [
          {
            id: 'floating-tab',
            contentType: 'agent-session',
            label: 'Temporary task',
            lastFocusedAt: 40
          }
        ],
        'wt-1': [
          {
            id: 'workspace-tab',
            contentType: 'agent-session',
            label: 'Workspace task',
            lastFocusedAt: 50
          }
        ]
      },
      tabsByWorktree: {},
      openFiles: []
    })

    expect(model.temporarySessions).toMatchObject([
      { id: 'floating-tab', title: 'Temporary task', scope: null, restoreTabId: 'floating-tab' }
    ])
    expect(model.sessionSummaries.map((session) => session.id)).toEqual(['workspace-tab'])
    expect(model.workspaces[0].sessions.map((session) => session.id)).toEqual(['workspace-tab'])
  })

  it('deduplicates mirrored floating tabs without collapsing sessions from different hosts', () => {
    const model = buildDesktopHomeModel({
      repos: [],
      worktreesByRepo: {},
      unifiedTabsByWorktree: {
        'runtime:a|global-floating-terminal': [
          { id: 'same-session', contentType: 'agent-session', label: 'Cloud A', createdAt: 20 }
        ],
        'runtime:b|global-floating-terminal': [
          { id: 'same-session', contentType: 'agent-session', label: 'Cloud B', createdAt: 10 }
        ]
      },
      tabsByWorktree: {
        'runtime:a|global-floating-terminal': [
          { id: 'same-session', contentType: 'agent-session', label: 'Legacy mirror', createdAt: 5 }
        ]
      },
      openFiles: []
    })

    expect(model.temporarySessions).toHaveLength(2)
    expect(model.temporarySessions.map((session) => session.executionHostId)).toEqual([
      'runtime:a',
      'runtime:b'
    ])
  })

  it('projects an assigned floating session under its concrete project', () => {
    const assignment = {
      projectId: 'project-1',
      projectIdentityKey: 'local|project:project-1',
      projectGroupId: 'space-1',
      executionHostId: 'local' as const,
      assignedAt: 100
    }
    const model = buildDesktopHomeModel({
      repos: [
        { id: 'repo-1', displayName: 'Project', path: '/project', projectGroupId: 'space-1' }
      ],
      worktreesByRepo: { 'repo-1': [] },
      unifiedTabsByWorktree: {
        'global-floating-terminal': [
          {
            id: 'floating-tab',
            contentType: 'agent-session',
            label: 'Saved task',
            createdAt: 50,
            projectAssignment: assignment
          }
        ]
      },
      tabsByWorktree: {},
      openFiles: [],
      projects: [{ id: 'project-1', displayName: 'Project', sourceRepoIds: ['repo-1'] }],
      projectGroups: [{ id: 'space-1', name: 'Space', parentGroupId: null, tabOrder: 0 }]
    })

    expect(model.temporarySessions).toEqual([])
    expect(model.projects[0].sessions).toMatchObject([
      { id: 'floating-tab', restoreTabId: 'floating-tab', projectAssignment: assignment }
    ])
    expect(model.sessionSummaries.map((session) => session.id)).toEqual(['floating-tab'])
  })
})

describe('formatHomeRelativeTime', () => {
  it('formats recent values without absolute fake timestamps', () => {
    expect(formatHomeRelativeTime(1_000, 31_000)).toBe('Just now')
    expect(formatHomeRelativeTime(1_000, 121_000)).toBe('2 min ago')
  })
})
