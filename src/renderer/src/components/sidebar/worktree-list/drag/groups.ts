import { ALL_GROUP_KEY, PINNED_GROUP_KEY } from '../grouping/group-keys'
import { getNaturalWorktreeIds } from '../../natural-worktree-ids'
import type { HostSectionRow } from '../../host-section-rows'
import type { WorktreeDragGroup } from '../../worktree-manual-order'

export function getWorktreeDragGroups(rows: HostSectionRow[]): WorktreeDragGroup[] {
  const groups: WorktreeDragGroup[] = []
  let current: { key: string; ids: string[] } | null = null
  const naturalWorktreeIds = getNaturalWorktreeIds(rows)

  for (const row of rows) {
    if (row.type === 'header') {
      current = { key: row.renderKey ?? row.key, ids: [] }
      groups.push({ key: current.key, worktreeIds: current.ids })
      continue
    }
    if (
      row.type === 'host-header' ||
      row.type === 'imported-worktrees-card' ||
      row.type === 'new-external-worktrees-inbox' ||
      row.type === 'pending-creation' ||
      row.type === 'folder-workspace'
    ) {
      continue
    }
    if (row.sectionKey === PINNED_GROUP_KEY && naturalWorktreeIds.has(row.worktree.id)) {
      continue
    }
    if (!current) {
      current = { key: ALL_GROUP_KEY, ids: [] }
      groups.push({ key: current.key, worktreeIds: current.ids })
    }
    current.ids.push(row.worktree.id)
  }

  return groups.filter((group) => group.worktreeIds.length > 0)
}

export function getWorktreeDragIndexes(rows: readonly HostSectionRow[]): {
  groupKeyByRowKey: Map<string, string>
  groupIndexByRowKey: Map<string, number>
} {
  const groupKeyByRowKey = new Map<string, string>()
  const groupIndexByRowKey = new Map<string, number>()
  const groupIndexes = new Map<string, number>()
  let currentGroupKey: string | undefined
  const naturalWorktreeIds = getNaturalWorktreeIds(rows)
  for (const row of rows) {
    if (row.type === 'header') {
      currentGroupKey = row.renderKey ?? row.key
      groupIndexes.set(currentGroupKey, 0)
      continue
    }
    if (row.type !== 'item') {
      continue
    }
    if (row.sectionKey === PINNED_GROUP_KEY && naturalWorktreeIds.has(row.worktree.id)) {
      continue
    }
    const groupKey = currentGroupKey ?? row.sectionKey
    const index = groupIndexes.get(groupKey) ?? 0
    groupKeyByRowKey.set(row.rowKey, groupKey)
    groupIndexByRowKey.set(row.rowKey, index)
    groupIndexes.set(groupKey, index + 1)
  }
  return { groupKeyByRowKey, groupIndexByRowKey }
}
