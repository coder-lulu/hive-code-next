import { describe, expect, it } from 'vitest'
import {
  repo,
  worktree,
  project,
  projectHostSetups
} from '../../worktree-list-groups-test-fixtures'
import type { Repo } from '../../../../../../shared/repo-types'
import type { ProjectGroup } from '../../../../../../shared/project-group-types'
import type { FolderWorkspace } from '../../../../../../shared/folder-workspace-types'
import { getRenderRowKey } from '../listing/render-row'
import type { buildRows } from './build-rows'
import { appendRuntimeOfflineDirectory, buildRuntimeOfflineRows } from './runtime-offline-rows'
import { OFFLINE_RUNTIME_GROUP_KEY } from './group-keys'
import { getWorktreeDragGroups, getWorktreeDragIndexes } from '../drag/groups'
import { getWorktreeDragUnitGroups } from '../../worktree-drag-units'
import { refreshWorktreeSidebarDragSession } from '../../worktree-sidebar-drag-autoscroll'
import { buildManualOrderUpdatesForGroupDrop } from '../../worktree-manual-order'

const remoteRepo: Repo = { ...repo, id: 'remote-repo', executionHostId: 'runtime:remote' }
const remoteWorktree = {
  ...worktree,
  id: 'remote-worktree',
  repoId: remoteRepo.id,
  hostId: 'runtime:remote' as const
}
function input(): Parameters<typeof buildRows> {
  return [
    'repo',
    [worktree, remoteWorktree],
    new Map([
      [repo.id, repo],
      [remoteRepo.id, remoteRepo]
    ]),
    null,
    new Set(),
    undefined,
    undefined,
    undefined,
    {},
    undefined,
    false,
    undefined,
    [],
    new Set(),
    new Map(),
    new Map(),
    [],
    {
      projects: [{ ...project, sourceRepoIds: [repo.id, remoteRepo.id] }],
      projectHostSetups: [
        projectHostSetups[0],
        {
          ...projectHostSetups[1],
          id: remoteRepo.id,
          repoId: remoteRepo.id,
          hostId: 'runtime:remote'
        }
      ]
    }
  ]
}

describe('runtime offline project rows', () => {
  it('keeps drag groups, indexes and session refresh scoped to each directory', () => {
    const result = buildRuntimeOfflineRows(input(), new Set(['remote']))
    const rows = appendRuntimeOfflineDirectory(
      result.onlineRows,
      result.offlineRows,
      result.offlineCount,
      new Set()
    )
    const groups = getWorktreeDragGroups(rows)
    const units = getWorktreeDragUnitGroups(rows)
    const indexes = getWorktreeDragIndexes(rows)
    const onlineItem = result.onlineRows.find((row) => row.type === 'item')!
    const offlineItem = result.offlineRows.find((row) => row.type === 'item')!
    const onlineKey = indexes.groupKeyByRowKey.get(onlineItem.rowKey)!
    const offlineKey = indexes.groupKeyByRowKey.get(offlineItem.rowKey)!
    expect(offlineKey).not.toBe(onlineKey)
    expect(groups.map((group) => group.key)).toEqual([onlineKey, offlineKey])
    expect(units.map((group) => group.key)).toEqual([onlineKey, offlineKey])
    expect(indexes.groupIndexByRowKey.get(offlineItem.rowKey)).toBe(0)
    expect(
      refreshWorktreeSidebarDragSession({
        session: {
          draggingWorktreeId: remoteWorktree.id,
          sourceGroupKey: offlineKey,
          draggedIds: [remoteWorktree.id],
          reorderDraggedIds: [remoteWorktree.id],
          reorderUnitDraggedIds: [remoteWorktree.id],
          rects: [],
          grab: null,
          anchor: null
        },
        groups,
        unitGroups: units,
        rects: []
      })
    ).toMatchObject({ sourceGroupKey: offlineKey, draggedIds: [remoteWorktree.id] })
    expect(
      buildManualOrderUpdatesForGroupDrop({
        groups,
        targetGroupKey: offlineKey,
        draggedIds: [remoteWorktree.id],
        dropIndex: 0,
        now: 1,
        allWorktreeIds: [worktree.id, remoteWorktree.id]
      }).orderedIds
    ).toEqual([worktree.id, remoteWorktree.id])
  })

  it('separates checkouts of the same project while keeping header identities unique', () => {
    const { onlineRows, offlineRows, offlineCount } = buildRuntimeOfflineRows(
      input(),
      new Set(['remote'])
    )
    expect(onlineRows).toMatchObject([
      { type: 'header', count: 1, repo: { id: repo.id } },
      { type: 'item', worktree: { id: worktree.id } }
    ])
    expect(offlineRows).toMatchObject([
      { type: 'header', count: 1, repo: { id: remoteRepo.id } },
      { type: 'item', worktree: { id: remoteWorktree.id } }
    ])
    const keys = [...onlineRows, ...offlineRows].map((row) => getRenderRowKey(row))
    expect(new Set(keys).size).toBe(keys.length)
    expect(offlineCount).toBe(1)
    const reconnected = buildRuntimeOfflineRows(input(), new Set())
    expect(reconnected.offlineRows).toEqual([])
    expect(reconnected.onlineRows.filter((row) => row.type === 'item')).toHaveLength(2)
  })

  it('keeps pinned offline workspaces out of the online pinned group', () => {
    const args = input()
    args[1] = [
      { ...worktree, isPinned: true },
      { ...remoteWorktree, isPinned: true }
    ]
    args[0] = 'workspace-status'
    const result = buildRuntimeOfflineRows(args, new Set(['remote']))
    expect(
      result.onlineRows.filter((row) => row.type === 'item').map((row) => row.worktree.id)
    ).toEqual([worktree.id])
    expect(
      result.offlineRows.filter((row) => row.type === 'item').map((row) => row.worktree.id)
    ).toEqual([remoteWorktree.id])
    expect(result.onlineRows[0]).toMatchObject({ type: 'header', count: 1 })
    expect(result.offlineRows[0]).toMatchObject({ type: 'header', count: 1 })
  })

  it('preserves pinned duplicate drag filtering in both directories', () => {
    const args = input()
    args[1] = [
      { ...worktree, isPinned: true },
      { ...remoteWorktree, isPinned: true }
    ]
    args[21] = 'duplicate-in-groups'
    const result = buildRuntimeOfflineRows(args, new Set(['remote']))
    const rows = appendRuntimeOfflineDirectory(
      result.onlineRows,
      result.offlineRows,
      result.offlineCount,
      new Set()
    )
    const groups = getWorktreeDragGroups(rows)
    const indexes = getWorktreeDragIndexes(rows)
    expect(groups.flatMap((group) => group.worktreeIds)).toEqual([worktree.id, remoteWorktree.id])
    expect(getWorktreeDragUnitGroups(rows).flatMap((group) => group.worktreeIds)).toEqual([
      worktree.id,
      remoteWorktree.id
    ])
    expect(
      rows.every(
        (row) =>
          row.type !== 'item' ||
          row.sectionKey !== 'pinned' ||
          !indexes.groupKeyByRowKey.has(row.rowKey)
      )
    ).toBe(true)
  })

  it('includes offline folder workspaces and empty projects without dropping their hierarchy', () => {
    const args = input()
    const group: ProjectGroup = {
      id: 'remote-group',
      name: 'Remote folders',
      executionHostId: 'runtime:remote',
      parentPath: '/remote',
      parentGroupId: null,
      createdFrom: 'manual',
      tabOrder: 0,
      isCollapsed: false,
      color: null,
      createdAt: 1,
      updatedAt: 1
    }
    const folder: FolderWorkspace = {
      id: 'folder',
      name: 'Remote folder',
      folderPath: '/remote/folder',
      projectGroupId: group.id,
      executionHostId: 'runtime:remote',
      linkedTask: null,
      comment: '',
      isArchived: false,
      isUnread: false,
      isPinned: false,
      sortOrder: 0,
      lastActivityAt: 1,
      createdAt: 1,
      updatedAt: 1
    }
    args[1] = [worktree]
    args[12] = [group]
    args[13] = new Set([remoteRepo.id])
    args[18] = [folder]
    const result = buildRuntimeOfflineRows(args, new Set(['remote']))
    expect(result.onlineRows.some((row) => row.type === 'folder-workspace')).toBe(false)
    expect(result.offlineRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'header', projectGroup: group }),
        expect.objectContaining({ type: 'folder-workspace', folderWorkspace: folder }),
        expect.objectContaining({ type: 'header', repo: remoteRepo, count: 0 })
      ])
    )
    expect(result.offlineCount).toBe(2)
  })

  it('collapses only offline contents and does not show an empty offline directory after filtering', () => {
    const result = buildRuntimeOfflineRows(input(), new Set(['remote']))
    const collapsed = appendRuntimeOfflineDirectory(
      result.onlineRows,
      result.offlineRows,
      result.offlineCount,
      new Set([OFFLINE_RUNTIME_GROUP_KEY])
    )
    expect(collapsed.filter((row) => row.type === 'item').map((row) => row.worktree.id)).toEqual([
      worktree.id
    ])
    expect(collapsed.at(-1)).toMatchObject({
      type: 'header',
      key: OFFLINE_RUNTIME_GROUP_KEY,
      count: 1
    })
    const filtered = input()
    filtered[1] = [worktree]
    filtered[2] = new Map([[repo.id, repo]])
    const filteredResult = buildRuntimeOfflineRows(filtered, new Set(['remote']))
    expect(filteredResult.offlineRows).toEqual([])
    expect(appendRuntimeOfflineDirectory(filteredResult.onlineRows, [], 0, new Set())).toBe(
      filteredResult.onlineRows
    )
  })

  it('does not move a local space with the same bare id as an offline space', () => {
    const args = input()
    const local: ProjectGroup = {
      id: 'shared',
      name: 'Local space',
      executionHostId: 'local',
      parentPath: null,
      parentGroupId: null,
      createdFrom: 'manual',
      tabOrder: 0,
      isCollapsed: false,
      color: null,
      createdAt: 1,
      updatedAt: 1
    }
    args[12] = [local, { ...local, name: 'Offline space', executionHostId: 'runtime:remote' }]
    const result = buildRuntimeOfflineRows(args, new Set(['remote']))
    expect(
      result.onlineRows.filter((row) => row.type === 'header').map((row) => row.label)
    ).not.toContain('Offline space')
    expect(
      result.offlineRows.filter((row) => row.type === 'header').map((row) => row.label)
    ).not.toContain('Local space')
  })
})
