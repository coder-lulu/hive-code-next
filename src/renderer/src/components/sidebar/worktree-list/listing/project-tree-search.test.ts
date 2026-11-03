import { describe, expect, it } from 'vitest'
import type { HostSectionRow } from '../../host-section-rows'
import { makeWorktree } from '../../worktree-list-lineage-card-test-fixtures'
import { filterProjectTreeRows } from './project-tree-search'

function item(id: string, displayName: string, depth = 0): HostSectionRow {
  return {
    type: 'item',
    rowKey: id,
    sectionKey: 'repo',
    groupDepth: 1,
    depth,
    repo: undefined,
    lineageTrail: [],
    isLastLineageChild: false,
    lineageChildCount: 0,
    worktree: makeWorktree({ id, displayName, branch: id, sortOrder: 0, instanceId: id })
  }
}
const rows: HostSectionRow[] = [
  { type: 'header', key: 'group', label: 'Team', projectGroupDepth: 0, count: 1, tone: '' },
  { type: 'header', key: 'repo', label: 'api', projectGroupDepth: 1, count: 3, tone: '' },
  item('main', 'main'),
  item('child', 'fix login', 1),
  item('sibling', 'other'),
  { type: 'header', key: 'group2', label: 'Personal', projectGroupDepth: 0, count: 1, tone: '' },
  {
    type: 'folder-workspace',
    key: 'folder',
    groupDepth: 1,
    depth: 0,
    projectGroup: {
      id: 'group2',
      name: 'Personal',
      parentPath: null,
      parentGroupId: null,
      createdFrom: 'manual',
      tabOrder: 1,
      isCollapsed: false,
      color: null,
      createdAt: 0,
      updatedAt: 0
    },
    folderWorkspace: {
      id: 'folder',
      projectGroupId: 'group2',
      name: 'api',
      folderPath: 'E:/notes/api',
      linkedTask: null,
      comment: '',
      isArchived: false,
      isUnread: false,
      isPinned: false,
      sortOrder: 0,
      lastActivityAt: 0,
      createdAt: 0,
      updatedAt: 0
    }
  }
]

describe('project tree search', () => {
  it('retains the exact ancestor path without unrelated siblings or groups', () => {
    expect(filterProjectTreeRows(rows, 'LOGIN')).toEqual(rows.slice(0, 4))
  })
  it('keeps descendants for a matched group and preserves their ordering', () => {
    expect(filterProjectTreeRows(rows, 'team')).toEqual(rows.slice(0, 5))
  })
  it('keeps distinct same-name resources and directly mounted folder workspaces', () => {
    expect(filterProjectTreeRows(rows, 'api')).toEqual(rows)
    expect(filterProjectTreeRows(rows, 'E:/notes')).toEqual(rows.slice(5))
  })
  it('returns the original tree on clear and no rows for a miss', () => {
    expect(filterProjectTreeRows(rows, ' ')).toBe(rows)
    expect(filterProjectTreeRows(rows, 'no match')).toEqual([])
  })
  it('keeps a matching ancestor discoverable when temporarily collapsed during search', () => {
    expect(filterProjectTreeRows(rows, 'login', new Set(['repo']))).toEqual(rows.slice(0, 2))
    expect(filterProjectTreeRows(rows, '', new Set(['repo']))).toBe(rows)
  })
})

it('keeps a sibling folder visible when a repository is collapsed during search', () => {
  const folder = rows[6]
  const siblings = [...rows.slice(0, 5), folder]
  expect(filterProjectTreeRows(siblings, 'api', new Set(['repo']))).toEqual([
    rows[0],
    rows[1],
    folder
  ])
})
