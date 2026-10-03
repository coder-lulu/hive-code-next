import type { HostSectionRow } from '../../host-section-rows'

function rowSearchText(row: HostSectionRow): string {
  switch (row.type) {
    case 'header':
      return `${row.label} ${row.repo?.path ?? ''}`
    case 'host-header':
      return row.label
    case 'item':
      return `${row.worktree.displayName} ${row.worktree.path} ${row.worktree.branch}`
    case 'folder-workspace':
      return `${row.folderWorkspace.name} ${row.folderWorkspace.folderPath}`
    case 'imported-worktrees-card':
    case 'new-external-worktrees-inbox':
    case 'pending-creation':
      return ''
  }
}

function rowDepth(row: HostSectionRow): number {
  return row.type === 'host-header'
    ? -1
    : row.type === 'header'
      ? (row.projectGroupDepth ?? 0)
      : row.type === 'item'
        ? row.groupDepth + 1 + row.depth
        : row.type === 'folder-workspace'
          ? row.groupDepth
          : Number.POSITIVE_INFINITY
}

/** Filters the existing ordered tree; ancestor identity and sibling order are unchanged. */
export function filterProjectTreeRows(
  rows: HostSectionRow[],
  query: string,
  collapsedGroups?: ReadonlySet<string>
): HostSectionRow[] {
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) {
    return rows
  }
  const keep = new Set<number>()
  const ancestors: { index: number; depth: number; matches: boolean }[] = []
  rows.forEach((row, index) => {
    const depth = rowDepth(row)
    while ((ancestors.at(-1)?.depth ?? Number.NEGATIVE_INFINITY) >= depth) {
      ancestors.pop()
    }
    const matches = rowSearchText(row).toLocaleLowerCase().includes(needle)
    const parentMatches = ancestors.some((ancestor) => ancestor.matches)
    if (matches || parentMatches) {
      keep.add(index)
      for (const ancestor of ancestors) {
        keep.add(ancestor.index)
      }
    }
    if (['host-header', 'header', 'item'].includes(row.type)) {
      ancestors.push({ index, depth, matches: matches || parentMatches })
    }
  })
  let collapsedDepth: number | null = null
  return rows.filter((row, index) => {
    if (!keep.has(index)) {
      return false
    }
    const depth = rowDepth(row)
    if (collapsedDepth !== null && depth > collapsedDepth) {
      return false
    }
    collapsedDepth = null
    if ((row.type === 'header' || row.type === 'host-header') && collapsedGroups?.has(row.key)) {
      collapsedDepth = depth
    }
    return true
  })
}
