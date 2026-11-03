import { rowKeyMatchesRenderRow } from './render-row-lookup'
import { OFFLINE_RUNTIME_GROUP_KEY } from '../grouping/group-keys'
import { getWorktreeExecutionHostId } from '../../../../../../shared/execution-host'
import {
  isOfflineRuntimeOwner,
  getProjectSetupRuntimeOwnerEnvironmentId
} from '@/lib/runtime-offline-directory'
import type { WorktreeOccurrencePlan } from '../../../../../../shared/worktree-occurrence-plan'
import type React from 'react'
import type { Virtualizer } from '@tanstack/react-virtual'
import type { AppState } from '@/store/types'
import type { PendingSidebarRowReveal, PendingSidebarWorktreeReveal } from '@/store/slices/ui'
import type { FolderWorkspace } from '../../../../../../shared/folder-workspace-types'
import type { ProjectGroup } from '../../../../../../shared/project-group-types'
import type { Repo } from '../../../../../../shared/repo-types'
import type { WorkspaceStatusDefinition, Worktree } from '../../../../../../shared/worktree/types'
import type { WorktreeLineage } from '../../../../../../shared/worktree/lineage-types'
import type { ExecutionHostId } from '../../../../../../shared/execution-host'
import type { RenderRow } from '../listing/render-row'
import type { ProjectGroupingModel } from '../../../../../../shared/project-section-grouping'
import type {
  PinnedWorktreeDisplayPolicy,
  WorktreeGroupBy
} from '../../../../../../shared/sidebar-list/row-types'
import { getFolderWorkspaceRevealGroupKeys } from './folder-reveal'
import { getWorktreeRevealCollapsedGroupKeys } from './worktree-reveal-group-keys'

export const MAX_REVEAL_RETRIES = 8

export type PendingSidebarRevealArgs = {
  offlineRuntimeEnvironmentIds?: ReadonlySet<string>
  occurrencePlan?: WorktreeOccurrencePlan<Worktree>
  pendingRevealWorktree: PendingSidebarWorktreeReveal | null
  pendingRevealSidebarRow: PendingSidebarRowReveal | null
  clearPendingRevealWorktreeId: () => void
  clearPendingRevealSidebarRow: () => void
  agentSendTargetWorktreeId: string | null
  renderRows: RenderRow[]
  virtualizer: Virtualizer<HTMLDivElement, HTMLDivElement>
  scrollRef: React.RefObject<HTMLDivElement | null>
  worktrees: Worktree[]
  folderWorkspaces: readonly FolderWorkspace[]
  repoMap: Map<string, Repo>
  worktreeMap: Map<string, Worktree>
  worktreeLineageById: Record<string, WorktreeLineage>
  collapsedGroups: Set<string>
  toggleGroup: (key: string) => void
  groupBy: WorktreeGroupBy
  pinnedDisplayPolicy: PinnedWorktreeDisplayPolicy
  defaultHostId: ExecutionHostId
  prCache: AppState['prCache'] | null
  workspaceStatuses: readonly WorkspaceStatusDefinition[]
  settings: AppState['settings']
  projectGroups: readonly ProjectGroup[]
  projectGrouping?: ProjectGroupingModel
  flashRevealedRow: (rowKey: string) => void
  markRevealScroll: (targetTop: number) => void
  schedulePendingRevealFrame: (callback: FrameRequestCallback) => void
  cancelPendingRevealFrames: () => void
}

export function expandGroupsForWorktreeReveal(
  args: PendingSidebarRevealArgs,
  worktreeId: string,
  executionHostId?: ExecutionHostId
): void {
  const hostScopedGroups = args.renderRows.some(
    (row) =>
      row.type === 'host-header' ||
      (row.type === 'header' &&
        row.collapseKey !== undefined &&
        !row.key.startsWith(`${OFFLINE_RUNTIME_GROUP_KEY}:`))
  )
  const folderGroupKeys = getFolderWorkspaceRevealGroupKeys(
    worktreeId,
    args.folderWorkspaces,
    args.projectGroups,
    {
      groupBy: args.groupBy,
      workspaceStatuses: args.workspaceStatuses,
      defaultHostId: args.defaultHostId,
      hostScopedGroups,
      executionHostId,
      offlineRuntimeEnvironmentIds: args.offlineRuntimeEnvironmentIds
    }
  )
  if (folderGroupKeys.length > 0) {
    for (const groupKey of folderGroupKeys) {
      if (args.collapsedGroups.has(groupKey)) {
        args.toggleGroup(groupKey)
      }
    }
    return
  }
  const targetWorktree = args.worktrees.find(
    (worktree) =>
      worktree.id === worktreeId &&
      (!executionHostId || !worktree.hostId || worktree.hostId === executionHostId)
  )
  if (!targetWorktree) {
    return
  }
  const setup = args.projectGrouping?.projectHostSetups.find(
    (setup) => setup.repoId === targetWorktree.repoId
  )
  if (
    args.collapsedGroups.has(OFFLINE_RUNTIME_GROUP_KEY) &&
    isOfflineRuntimeOwner(
      getWorktreeExecutionHostId(
        targetWorktree,
        args.repoMap.get(targetWorktree.repoId),
        args.defaultHostId
      ),
      args.offlineRuntimeEnvironmentIds ?? new Set(),
      targetWorktree.runtimeOwnerEnvironmentId ?? getProjectSetupRuntimeOwnerEnvironmentId(setup)
    )
  ) {
    args.toggleGroup(OFFLINE_RUNTIME_GROUP_KEY)
  }
  for (const groupKey of getWorktreeRevealCollapsedGroupKeys({
    ...args,
    worktree: targetWorktree,
    hostScopedGroups
  })) {
    args.toggleGroup(groupKey)
  }
}

export function resolvePendingSidebarReveal(args: {
  targetIndex: number
  targetWorktreeStillExists: boolean
}): 'scroll-and-clear' | 'clear' | 'keep-pending' {
  if (args.targetIndex !== -1) {
    return 'scroll-and-clear'
  }
  return args.targetWorktreeStillExists ? 'keep-pending' : 'clear'
}

export function expandGroupsForSidebarRowReveal(
  args: PendingSidebarRevealArgs,
  rowKey: string
): boolean {
  const explicit = rowKey.startsWith(`${OFFLINE_RUNTIME_GROUP_KEY}:`)
  if (!explicit) {
    if (args.renderRows.some((row) => rowKeyMatchesRenderRow(row, rowKey))) {
      return false
    }
    const repoIds = rowKey.startsWith('repo:')
      ? [rowKey.slice(5)]
      : rowKey.startsWith('project:')
        ? (args.projectGrouping?.projectHostSetups
            .filter((setup) => setup.projectId === rowKey.slice(8))
            .map((setup) => setup.repoId) ?? [])
        : []
    const offlineTarget = repoIds.some((repoId) => {
      const repo = args.repoMap.get(repoId)
      const setup = args.projectGrouping?.projectHostSetups.find((entry) => entry.repoId === repoId)
      return isOfflineRuntimeOwner(
        repo?.executionHostId,
        args.offlineRuntimeEnvironmentIds ?? new Set(),
        getProjectSetupRuntimeOwnerEnvironmentId(setup)
      )
    })
    if (!offlineTarget) {
      return false
    }
  }
  let expanded = false
  for (const key of [
    OFFLINE_RUNTIME_GROUP_KEY,
    explicit ? rowKey.slice(OFFLINE_RUNTIME_GROUP_KEY.length + 1) : rowKey
  ]) {
    if (args.collapsedGroups.has(key)) {
      args.toggleGroup(key)
      expanded = true
    }
  }
  return expanded
}
