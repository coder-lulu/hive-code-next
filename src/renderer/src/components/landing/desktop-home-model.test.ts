import { describe, expect, it } from 'vitest'
import { buildDesktopHomeModel, formatHomeRelativeTime } from './desktop-home-model'
import { APP_DISPLAY_NAME } from '../../product-brand'

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
})

describe('formatHomeRelativeTime', () => {
  it('formats recent values without absolute fake timestamps', () => {
    expect(formatHomeRelativeTime(1_000, 31_000)).toBe('Just now')
    expect(formatHomeRelativeTime(1_000, 121_000)).toBe('2 min ago')
  })
})
