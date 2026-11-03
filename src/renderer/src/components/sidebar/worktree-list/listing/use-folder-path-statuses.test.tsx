// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import type { FolderWorkspace } from '../../../../../../shared/folder-workspace-types'
import type { ProjectGroup } from '../../../../../../shared/project-group-types'
import { useFolderWorkspacePathStatusRows } from './use-folder-path-statuses'

const state = vi.hoisted(() => ({
  folderWorkspacePathStatuses: {},
  settings: { activeRuntimeEnvironmentId: 'remote' },
  fetchFolderWorkspacePathStatus: vi.fn().mockResolvedValue(null),
  getFolderWorkspacePathStatusCacheKey: vi.fn(
    (request, options) =>
      `${options.runtimeEnvironmentId ?? 'local'}:${request.scope}:${request.projectGroupId ?? request.folderWorkspaceId}`
  ),
  getFreshFolderWorkspacePathStatus: vi.fn().mockReturnValue(null)
}))
vi.mock('@/store', () => ({
  useAppStore: (selector: (value: typeof state) => unknown) => selector(state)
}))
vi.mock('zustand/react/shallow', () => ({ useShallow: (selector: unknown) => selector }))
vi.mock('@/lib/folder-workspace-path-status-cache-expiry', () => ({
  useFolderWorkspacePathStatusCacheExpiryTick: () => 0
}))

it('probes and reads same-ID rows independently for local and remote hosts', () => {
  const projectGroups = [
    { id: 'same-group', parentPath: '/project' },
    { id: 'same-group', parentPath: '/project', executionHostId: 'runtime:remote' }
  ] as ProjectGroup[]
  const folderWorkspaces = [
    { id: 'same-folder', projectGroupId: 'same-group' },
    { id: 'same-folder', projectGroupId: 'same-group', executionHostId: 'runtime:remote' }
  ] as FolderWorkspace[]
  let read!: ReturnType<typeof useFolderWorkspacePathStatusRows>
  function Probe() {
    read = useFolderWorkspacePathStatusRows({
      allRepoIds: [],
      repoMap: new Map(),
      projectGroups,
      folderWorkspaces,
      sshConnectionStates: new Map()
    })
    return null
  }
  const renderer = createRoot(document.createElement('div'))
  act(() => {
    renderer.render(createElement(Probe))
  })
  expect(state.fetchFolderWorkspacePathStatus).toHaveBeenCalledTimes(4)
  for (const runtimeEnvironmentId of [null, 'remote']) {
    expect(state.fetchFolderWorkspacePathStatus).toHaveBeenCalledWith(
      { scope: 'project-group', projectGroupId: 'same-group' },
      { force: true, runtimeEnvironmentId }
    )
    expect(state.fetchFolderWorkspacePathStatus).toHaveBeenCalledWith(
      { scope: 'folder-workspace', folderWorkspaceId: 'same-folder' },
      { force: true, runtimeEnvironmentId }
    )
  }
  const request = { scope: 'folder-workspace' as const, folderWorkspaceId: 'same-folder' }
  read(request, 'local')
  read(request, 'runtime:remote')
  expect(state.getFreshFolderWorkspacePathStatus.mock.calls).toEqual([
    [request, { runtimeEnvironmentId: null }],
    [request, { runtimeEnvironmentId: 'remote' }]
  ])
  act(() => renderer.unmount())
})
