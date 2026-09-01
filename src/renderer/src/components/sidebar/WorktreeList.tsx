/* eslint-disable max-lines -- The sidebar owns the virtualized hierarchy and its creation actions. */

import React, { useCallback, useMemo } from 'react'
import { useAppStore } from '@/store'
import { useShallow } from 'zustand/react/shallow'
import {
  useAllWorktrees,
  useProjectHostSetupProjection,
  useRepoMap,
  useWorktreeMap
} from '@/store/selectors'
import type { ProjectGroup } from '../../../../shared/project-group-types'
import type { Repo } from '../../../../shared/repo-types'
import {
  getRepoExecutionHostId,
  getSettingsFocusedExecutionHostId
} from '../../../../shared/execution-host'
import { getProjectGroupSubtreeIds } from '../../../../shared/project-groups'
import { getProjectGroupHostId } from '@/store/slices/project-group-owner-routing'
import { getActiveSidebarWorkspaceId } from '../../../../shared/workspace-scope'
import { getPinnedWorktreeDisplayPolicy } from './worktree-list/grouping/row-types'
import { selectWorktreeListReviewCacheInputs } from './worktree-list/listing/review-cache-inputs'
import type { VirtualizedScrollAnchor } from '@/hooks/useVirtualizedScrollAnchor'
import { SidebarWorktreeListDialogs } from './worktree-list/rows/ProjectGroupDialogs'
import { SidebarWorktreeListEmptyState } from './worktree-list/listing/EmptyState'
import { VirtualizedWorktreeViewport } from './worktree-list/viewport/VirtualizedWorktreeViewport'
import { markSidebarWorktreeActiveImmediately } from './worktree-list/rows/option-dom'
import { EMPTY_PROJECT_GROUPS } from './worktree-list/viewport/viewport-props'
import { NOOP_WORKSPACE_BOARD_DRAG_PREVIEW_CALLBACK } from './worktree-list/drag/drop-commit-context'
import { useAgentSendTargetWorktreeId } from './worktree-list/listing/use-agent-send-target'
import { useEffectiveCollapsedGroups } from './worktree-list/listing/use-collapsed-groups'
import { useProjectGroupDialogs } from './worktree-list/rows/use-project-group-dialogs'
import { useSidebarExternalWorktreeCards } from './worktree-list/listing/use-external-worktree-cards'
import { useSidebarHostVisibleScope } from './worktree-list/listing/use-host-visible-scope'
import { useSidebarRevealRequests } from './worktree-list/navigation/use-reveal-requests'
import { useSidebarSectionRows } from './worktree-list/listing/use-section-rows'
import { useSidebarWorktreeFilters } from './worktree-list/listing/use-filters'
import { useSidebarWorktreeSelection } from './worktree-list/navigation/use-selection'
import { useSidebarWorktreeSortOrder } from './worktree-list/listing/use-sort-order'
import { useVisibleSidebarWorktrees } from './worktree-list/listing/use-visible-worktrees'
import { useWorktreeStatusMutations } from './worktree-list/drag/use-status-mutations'
import { shouldFiltersHideAllRows } from './sidebar-empty-state-gate'
import { buildWorktreeManualOrderCatalog } from './worktree-manual-order-catalog'
import {
  hasDesktopHomeSessionDragData,
  readDesktopHomeSessionDragData
} from '../landing/desktop-home-session-drag'

type WorktreeListProps = {
  scrollOffsetRef: React.MutableRefObject<number>
  scrollAnchorRef: React.MutableRefObject<VirtualizedScrollAnchor>
  workspaceBoardOpen?: boolean
  onWorkspaceBoardDragPreviewStart?: () => void
  onWorkspaceBoardDragPreviewCommit?: () => void
  onWorkspaceBoardDragPreviewCancel?: () => void
}

const WorktreeList = React.memo(function WorktreeList({
  scrollOffsetRef,
  scrollAnchorRef,
  workspaceBoardOpen = false,
  onWorkspaceBoardDragPreviewStart = NOOP_WORKSPACE_BOARD_DRAG_PREVIEW_CALLBACK,
  onWorkspaceBoardDragPreviewCommit = NOOP_WORKSPACE_BOARD_DRAG_PREVIEW_CALLBACK,
  onWorkspaceBoardDragPreviewCancel = NOOP_WORKSPACE_BOARD_DRAG_PREVIEW_CALLBACK
}: WorktreeListProps) {
  // ── Granular selectors (each is a primitive or shallow-stable ref) ──
  const allWorktrees = useAllWorktrees()
  const repoMap = useRepoMap()
  const worktreeMap = useWorktreeMap()
  const repos = useAppStore((s) => s.repos)
  const worktreeLineageById = useAppStore((s) => s.worktreeLineageById)
  const workspaceLineageByChildKey = useAppStore((s) => s.workspaceLineageByChildKey)
  const detectedWorktreesByRepo = useAppStore((s) => s.detectedWorktreesByRepo)
  const activeWorktreeId = useAppStore((s) => s.activeWorktreeId)
  const activeRepoId = useAppStore((s) => s.activeRepoId)
  const activeWorkspaceExecutionHostId = useAppStore((s) => s.activeWorkspaceExecutionHostId)
  const activeWorkspaceKey = useAppStore((s) => s.activeWorkspaceKey)
  const currentSidebarWorktreeId = useMemo(
    () => getActiveSidebarWorkspaceId(activeWorkspaceKey, activeWorktreeId),
    [activeWorkspaceKey, activeWorktreeId]
  )
  const groupBy = useAppStore((s) => s.groupBy)
  const workspaceStatuses = useAppStore((s) => s.workspaceStatuses)
  const sortBy = useAppStore((s) => s.sortBy)
  const projectOrderBy = useAppStore((s) => s.projectOrderBy)
  const openModal = useAppStore((s) => s.openModal)
  const openSettingsPage = useAppStore((s) => s.openSettingsPage)
  const openSettingsTarget = useAppStore((s) => s.openSettingsTarget)
  const activeView = useAppStore((s) => s.activeView)
  const activeModal = useAppStore((s) => s.activeModal)
  const pendingRevealWorktree = useAppStore((s) => s.pendingRevealWorktree)
  const pendingRevealSidebarRow = useAppStore((s) => s.pendingRevealSidebarRow)
  const clearPendingRevealWorktreeId = useAppStore((s) => s.clearPendingRevealWorktreeId)
  const clearPendingRevealSidebarRow = useAppStore((s) => s.clearPendingRevealSidebarRow)
  const collapsedGroups = useAppStore((s) => s.collapsedGroups)
  const toggleGroup = useAppStore((s) => s.toggleCollapsedGroup)
  const projectGroups = useAppStore((s) => s.projectGroups ?? EMPTY_PROJECT_GROUPS)
  const folderWorkspaces = useAppStore((s) => s.folderWorkspaces)
  const settings = useAppStore((s) => s.settings)
  const cardProps = useAppStore((s) => s.worktreeCardProperties)
  const { prCache, hostedReviewCache } = useAppStore(
    useShallow((s) => selectWorktreeListReviewCacheInputs(s, groupBy, cardProps))
  )
  const pinnedDisplayPolicy = getPinnedWorktreeDisplayPolicy(settings)
  const defaultHostId = getSettingsFocusedExecutionHostId(settings)
  const projectHostSetupProjection = useProjectHostSetupProjection()
  const projectGrouping = useMemo(
    () => ({
      projects: projectHostSetupProjection.projects,
      projectHostSetups: projectHostSetupProjection.setups
    }),
    [projectHostSetupProjection]
  )

  const agentSendTargetWorktreeId = useAgentSendTargetWorktreeId()
  const { filterState, hasFilters, clearFilters } = useSidebarWorktreeFilters()
  const sortedIds = useSidebarWorktreeSortOrder({ allWorktrees, repoMap, sortBy })
  const manualOrderCatalog = useMemo(
    () => buildWorktreeManualOrderCatalog({ worktrees: allWorktrees, folderWorkspaces }),
    [allWorktrees, folderWorkspaces]
  )
  const { visibleWorktrees, pairedDeviceIdsByEnvironment } = useVisibleSidebarWorktrees({
    filterState,
    sortBy,
    sortedIds,
    repoMap,
    worktreeLineageById,
    settings,
    agentSendTargetWorktreeId
  })
  const effectiveCollapsedGroups = useEffectiveCollapsedGroups({
    collapsedGroups,
    agentSendTargetWorktreeId,
    groupBy,
    pinnedDisplayPolicy,
    visibleWorktrees,
    repoMap,
    worktreeMap,
    worktreeLineageById,
    prCache,
    workspaceStatuses,
    settings,
    projectGroups,
    projectGrouping,
    folderWorkspaces,
    defaultHostId
  })
  const visibleScope = useSidebarHostVisibleScope({
    filterState,
    defaultHostId,
    repos,
    projectGroups,
    folderWorkspaces,
    pairedDeviceIdsByEnvironment
  })
  const externalWorktreeCards = useSidebarExternalWorktreeCards({
    repos,
    visibleReposForRows: visibleScope.visibleReposForRows,
    detectedWorktreesByRepo,
    filterRepoIds: filterState.filterRepoIds
  })
  const rowModel = useSidebarSectionRows({
    groupBy,
    projectOrderBy,
    pinnedDisplayPolicy,
    defaultHostId,
    worktrees: visibleWorktrees,
    repos,
    repoMap,
    worktreeMap,
    worktreeLineageById,
    prCache,
    settings,
    workspaceStatuses,
    effectiveCollapsedGroups,
    projectGrouping,
    visibleReposForRows: visibleScope.visibleReposForRows,
    visibleProjectGroupsForRows: visibleScope.visibleProjectGroupsForRows,
    visibleFolderWorkspacesForRows: visibleScope.visibleFolderWorkspacesForRows,
    importedWorktreesByRepo: externalWorktreeCards.importedWorktreesByRepo,
    newExternalWorktreesInboxByRepo: externalWorktreeCards.newExternalWorktreesInboxByRepo,
    filterRepoIds: filterState.filterRepoIds,
    visibleWorkspaceHostIds: filterState.visibleWorkspaceHostIds,
    workspaceHostScope: filterState.workspaceHostScope
  })
  const selection = useSidebarWorktreeSelection({
    sectionRows: rowModel.sectionRows,
    pinnedDisplayPolicy
  })
  const statusMutations = useWorktreeStatusMutations({
    manualOrderCatalog,
    worktreeMap,
    workspaceStatuses,
    sortBy
  })
  const projectGroupDialogs = useProjectGroupDialogs({ repos, repoMap, projectGroups })

  const handleImmediateWorktreeActivate = useCallback((worktreeId: string, rowKey?: string) => {
    // Why: re-rendering the virtualized sidebar on the pointer path adds visible latency; mutate the row directly and let store state reconcile after.
    markSidebarWorktreeActiveImmediately(worktreeId, rowKey)
  }, [])

  const handleCreateForRepo = useCallback(
    (projectId: string) => {
      openModal('new-workspace-composer', { initialRepoId: projectId, telemetrySource: 'sidebar' })
    },
    [openModal]
  )
  const handleAddProjectToProjectGroup = useCallback(
    (projectGroup: ProjectGroup | null) => {
      // AddRepoDialog currently owns the source/host selection flow. Preserve
      // the originating space in modalData so the add flow can associate the
      // resulting project without putting global actions back in the Spaces
      // header. The derived ungrouped space intentionally carries null.
      openModal('add-repo', {
        projectGroupScoped: true,
        projectGroupId: projectGroup?.id ?? null,
        projectGroupExecutionHostId:
          projectGroup &&
          (projectGroup.executionHostId?.trim() || projectGroup.connectionId?.trim())
            ? getProjectGroupHostId(projectGroup)
            : defaultHostId
      })
    },
    [defaultHostId, openModal]
  )
  const handleOpenRepoSettings = useCallback(
    (projectId: string, sectionId?: string) => {
      openSettingsTarget({ pane: 'repo', repoId: projectId, ...(sectionId ? { sectionId } : {}) })
      openSettingsPage()
    },
    [openSettingsPage, openSettingsTarget]
  )
  const handleOpenWorktreeVisibility = useCallback(
    (repo: Repo) => {
      openModal('worktree-visibility', { repoId: repo.id, hostId: getRepoExecutionHostId(repo) })
    },
    [openModal]
  )
  const handleRemoveProject = useCallback(
    (repo: Repo) => {
      openModal('confirm-remove-folder', {
        repoId: repo.id,
        displayName: repo.displayName,
        hostId: getRepoExecutionHostId(repo)
      })
    },
    [openModal]
  )
  const handleCreateFolderWorkspace = useCallback(
    (projectGroup: ProjectGroup) => {
      if (!projectGroup.parentPath) {
        return
      }
      openModal('new-workspace-composer', {
        initialProjectGroupId: projectGroup.id,
        telemetrySource: 'sidebar'
      })
    },
    [openModal]
  )
  const handleCreateWorkspaceForProjectGroup = useCallback(
    (projectGroup: ProjectGroup | null) => {
      const groupIds = projectGroup
        ? getProjectGroupSubtreeIds(projectGroups, projectGroup.id)
        : null
      const knownGroupIds = new Set(projectGroups.map((group) => group.id))
      const ownerHostId = projectGroup ? getProjectGroupHostId(projectGroup) : defaultHostId
      const groupCandidates = repos.filter((repo) => {
        if (!groupIds) {
          // The derived "Ungrouped" space must not reach into a persisted
          // space just because the active repository happens to be elsewhere.
          // Treat missing group metadata as ungrouped during startup hydration,
          // matching the row projection's fallback behavior.
          return repo.projectGroupId == null || !knownGroupIds.has(repo.projectGroupId)
        }
        return typeof repo.projectGroupId === 'string' && groupIds.has(repo.projectGroupId)
      })
      const hasExplicitOwnerHost = Boolean(
        projectGroup?.executionHostId?.trim() || projectGroup?.connectionId?.trim()
      )
      // Legacy groups predate host stamping. Do not strand a remote repo in
      // those groups by treating the missing owner as local; use the source's
      // host when the group itself has no explicit owner.
      const hostCandidates = groupCandidates.filter(
        (repo) => getRepoExecutionHostId(repo) === ownerHostId
      )
      const candidates = projectGroup && !hasExplicitOwnerHost ? groupCandidates : hostCandidates
      const activeCandidates = projectGroup && hasExplicitOwnerHost ? candidates : groupCandidates
      const repo =
        (activeRepoId && activeCandidates.find((candidate) => candidate.id === activeRepoId)) ??
        candidates.find((candidate) => getRepoExecutionHostId(candidate) === defaultHostId) ??
        candidates[0]
      if (repo) {
        // A space is a container for existing repos. Its plus action always
        // enters the canonical worktree composer with that repo preselected.
        openModal('new-workspace-composer', {
          initialRepoId: repo.id,
          telemetrySource: 'sidebar'
        })
        return
      }
      const folderSourceGroupId = projectGroup
        ? folderWorkspaces.find((workspace) => groupIds?.has(workspace.projectGroupId))
            ?.projectGroupId
        : undefined
      if (folderSourceGroupId || projectGroup?.parentPath) {
        // Folder-backed spaces can create a non-Git workspace when they have
        // no repository source yet.
        openModal('new-workspace-composer', {
          initialProjectGroupId: folderSourceGroupId ?? projectGroup!.id,
          telemetrySource: 'sidebar'
        })
        return
      }
      // A stale/empty space cannot create a worktree without a source. Keep
      // the existing Add Project flow rather than manufacturing a repo row.
      openModal('add-repo', {
        projectGroupScoped: true,
        projectGroupId: projectGroup?.id ?? null,
        projectGroupExecutionHostId:
          projectGroup &&
          (projectGroup.executionHostId?.trim() || projectGroup.connectionId?.trim())
            ? getProjectGroupHostId(projectGroup)
            : defaultHostId
      })
    },
    [activeRepoId, defaultHostId, folderWorkspaces, openModal, projectGroups, repos]
  )
  const handleTemporarySessionDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!hasDesktopHomeSessionDragData(event.dataTransfer)) {
      return false
    }
    const targetElement =
      event.target instanceof Element
        ? event.target.closest(
            '[data-repo-header-id], [data-project-group-header-id], [data-ungrouped-project-group-header]'
          )
        : null
    if (!targetElement) {
      return false
    }
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    return true
  }, [])
  const handleTemporarySessionDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      const payload = readDesktopHomeSessionDragData(event.dataTransfer)
      if (!payload) {
        return false
      }
      const targetElement =
        event.target instanceof Element
          ? event.target.closest(
              '[data-repo-header-id], [data-project-group-header-id], [data-ungrouped-project-group-header]'
            )
          : null
      if (!targetElement) {
        return false
      }
      const repoId = targetElement.getAttribute('data-repo-header-id')
      const projectGroupId = targetElement.getAttribute('data-project-group-header-id')
      const repo = repoId ? (repos.find((entry) => entry.id === repoId) ?? null) : null
      const projectGroup = projectGroupId
        ? (projectGroups.find((entry) => entry.id === projectGroupId) ?? null)
        : null
      event.preventDefault()
      event.stopPropagation()
      if (repo) {
        openModal('new-workspace-composer', {
          initialRepoId: repo.id,
          initialPrompt: payload.title,
          telemetrySource: 'sidebar'
        })
        return true
      }
      if (targetElement.hasAttribute('data-ungrouped-project-group-header')) {
        const knownGroupIds = new Set(projectGroups.map((group) => group.id))
        const ungroupedRepos = repos.filter(
          (candidate) =>
            candidate.projectGroupId == null || !knownGroupIds.has(candidate.projectGroupId)
        )
        const hostMatchedRepos = payload.executionHostId
          ? ungroupedRepos.filter(
              (candidate) => getRepoExecutionHostId(candidate) === payload.executionHostId
            )
          : ungroupedRepos
        const candidates = hostMatchedRepos.length > 0 ? hostMatchedRepos : ungroupedRepos
        const selectedRepo =
          (activeRepoId && candidates.find((candidate) => candidate.id === activeRepoId)) ??
          candidates.find((candidate) => getRepoExecutionHostId(candidate) === defaultHostId) ??
          candidates[0]
        if (selectedRepo) {
          openModal('new-workspace-composer', {
            initialRepoId: selectedRepo.id,
            initialPrompt: payload.title,
            telemetrySource: 'sidebar'
          })
        } else {
          openModal('add-repo', {
            projectGroupScoped: true,
            projectGroupId: null,
            projectGroupExecutionHostId: defaultHostId
          })
        }
        return true
      }
      if (projectGroup) {
        const groupIds = getProjectGroupSubtreeIds(projectGroups, projectGroup.id)
        const ownerHostId = getProjectGroupHostId(projectGroup)
        const groupCandidates = repos.filter(
          (candidate) =>
            typeof candidate.projectGroupId === 'string' && groupIds.has(candidate.projectGroupId)
        )
        const hasExplicitOwnerHost = Boolean(
          projectGroup.executionHostId?.trim() || projectGroup.connectionId?.trim()
        )
        const hostCandidates = groupCandidates.filter(
          (candidate) => getRepoExecutionHostId(candidate) === ownerHostId
        )
        const candidates = hasExplicitOwnerHost ? hostCandidates : groupCandidates
        const activeCandidates = hasExplicitOwnerHost ? candidates : groupCandidates
        const selectedRepo =
          (activeRepoId && activeCandidates.find((candidate) => candidate.id === activeRepoId)) ??
          candidates.find((candidate) => getRepoExecutionHostId(candidate) === defaultHostId) ??
          candidates[0]
        if (selectedRepo) {
          openModal('new-workspace-composer', {
            initialRepoId: selectedRepo.id,
            initialPrompt: payload.title,
            telemetrySource: 'sidebar'
          })
          return true
        }
        const folderSourceGroupId = folderWorkspaces.find((workspace) =>
          groupIds.has(workspace.projectGroupId)
        )?.projectGroupId
        if (folderSourceGroupId || projectGroup.parentPath) {
          openModal('new-workspace-composer', {
            initialProjectGroupId: folderSourceGroupId ?? projectGroup.id,
            initialPrompt: payload.title,
            telemetrySource: 'sidebar'
          })
          return true
        }
        openModal('add-repo', {
          projectGroupScoped: true,
          projectGroupId: projectGroup.id,
          projectGroupExecutionHostId: hasExplicitOwnerHost ? ownerHostId : defaultHostId
        })
        return true
      }
      return false
    },
    [activeRepoId, defaultHostId, folderWorkspaces, openModal, projectGroups, repos]
  )

  useSidebarRevealRequests({
    groupBy,
    renderedSidebarRowKeys: rowModel.renderedSidebarRowKeys,
    renderedWorktreeIdentities: selection.renderedWorktreeIdentities,
    currentSidebarWorktreeId,
    currentSidebarExecutionHostId: activeWorkspaceExecutionHostId,
    worktreeMap,
    worktrees: allWorktrees,
    folderWorkspaces,
    hasFilters,
    clearFilters
  })

  const filtersHideAllRows = shouldFiltersHideAllRows({
    hasFilters,
    visibleWorktreeCount: visibleWorktrees.length,
    visibleFolderWorkspaceCount: visibleScope.visibleFolderWorkspacesForRows.length,
    placeholderRepoCount: rowModel.placeholderRepoIds.size,
    importedWorktreeCardCount: externalWorktreeCards.importedWorktreesByRepo.size
  })
  // Why: when active filters hide every row, the Clear Filters empty state must win over Project Group headers.
  if (rowModel.rows.length === 0 || filtersHideAllRows) {
    return <SidebarWorktreeListEmptyState hasFilters={hasFilters} onClearFilters={clearFilters} />
  }

  return (
    <>
      <SidebarWorktreeListDialogs
        dialogs={projectGroupDialogs}
        repos={repos}
        settings={settings}
        suppressExternalWorktreeInboxRepoId={
          externalWorktreeCards.suppressExternalWorktreeInboxRepoId
        }
        setSuppressExternalWorktreeInboxRepoId={
          externalWorktreeCards.setSuppressExternalWorktreeInboxRepoId
        }
        newExternalWorktreeInboxActionState={
          externalWorktreeCards.newExternalWorktreeInboxActionState
        }
        onConfirmSuppressExternalWorktreeInbox={() => {
          void externalWorktreeCards.handleConfirmSuppressExternalWorktreeInbox()
        }}
        onOpenWorktreeVisibility={handleOpenWorktreeVisibility}
      />
      <VirtualizedWorktreeViewport
        // Why: status headers move during wake (inactive -> active); key only on grouping mode so row identity survives.
        key={`group:${groupBy}:host:${filterState.visibleWorkspaceHostIds?.join(',') ?? 'all'}:lineage`}
        rows={rowModel.sectionRows}
        // Why: full-page nav views aren't scoped to a worktree, so no sidebar card should look selected.
        activeWorktreeId={
          activeView === 'tasks' || activeView === 'activity' ? null : currentSidebarWorktreeId
        }
        activeWorkspaceExecutionHostId={activeWorkspaceExecutionHostId}
        currentWorktreeId={currentSidebarWorktreeId}
        groupBy={groupBy}
        pinnedDisplayPolicy={pinnedDisplayPolicy}
        projectOrderBy={projectOrderBy}
        toggleGroup={toggleGroup}
        collapsedGroups={effectiveCollapsedGroups}
        handleCreateForRepo={handleCreateForRepo}
        handleOpenRepoSettings={handleOpenRepoSettings}
        handleOpenWorktreeVisibility={handleOpenWorktreeVisibility}
        handleShowImportedWorktrees={externalWorktreeCards.handleShowImportedWorktrees}
        handleKeepImportedWorktreesHidden={externalWorktreeCards.handleKeepImportedWorktreesHidden}
        importedWorktreeCardActionState={externalWorktreeCards.importedWorktreeCardActionState}
        handleOpenSuppressExternalWorktreeInbox={
          externalWorktreeCards.handleOpenSuppressExternalWorktreeInbox
        }
        newExternalWorktreeInboxActionState={
          externalWorktreeCards.newExternalWorktreeInboxActionState
        }
        handleRemoveProject={handleRemoveProject}
        handleCreateGroupFromRepo={projectGroupDialogs.handleCreateGroupFromRepo}
        handleMoveProjectToGroup={projectGroupDialogs.handleMoveProjectToGroup}
        handleRemoveProjectFromGroup={projectGroupDialogs.handleRemoveProjectFromGroup}
        handleRenameProjectGroup={projectGroupDialogs.handleRenameProjectGroup}
        handleDeleteProjectGroup={projectGroupDialogs.handleDeleteProjectGroup}
        handleCreateFolderWorkspace={handleCreateFolderWorkspace}
        handleCreateWorkspaceForProjectGroup={handleCreateWorkspaceForProjectGroup}
        handleAddProjectToProjectGroup={handleAddProjectToProjectGroup}
        activeModal={activeModal}
        pendingRevealWorktree={pendingRevealWorktree}
        pendingRevealSidebarRow={pendingRevealSidebarRow}
        clearPendingRevealWorktreeId={clearPendingRevealWorktreeId}
        clearPendingRevealSidebarRow={clearPendingRevealSidebarRow}
        agentSendTargetWorktreeId={agentSendTargetWorktreeId}
        worktrees={visibleWorktrees}
        folderWorkspaces={folderWorkspaces}
        selectedWorktreeIds={selection.selectedWorktreeIds}
        selectedWorktrees={selection.selectedWorktrees}
        onSelectionGesture={selection.updateSelectionForGesture}
        onImmediateWorktreeActivate={handleImmediateWorktreeActivate}
        onContextMenuSelect={selection.selectForContextMenu}
        repoMap={repoMap}
        defaultHostId={defaultHostId}
        worktreeMap={worktreeMap}
        worktreeLineageById={worktreeLineageById}
        workspaceLineageByChildKey={workspaceLineageByChildKey}
        allRepoIds={rowModel.allRepoIds}
        onReorderHostSections={rowModel.handleReorderHostSections}
        onHostDragActiveChange={rowModel.setHostDragActive}
        prCache={prCache}
        hostedReviewCache={hostedReviewCache}
        workspaceStatuses={workspaceStatuses}
        projectGrouping={projectGrouping}
        projectGroups={projectGroups}
        onMoveWorktreeToStatus={statusMutations.moveWorktreeToStatus}
        onMoveWorktreesToStatus={statusMutations.moveWorktreesToStatus}
        onMoveWorktreesToStatusAtIndex={statusMutations.moveWorktreesToStatusAtIndex}
        onPinWorktree={statusMutations.pinWorktree}
        onPinWorktrees={statusMutations.pinWorktrees}
        onDropWorktreesOnWorkspaceBoard={statusMutations.dropWorktreesOnWorkspaceBoard}
        workspaceBoardOpen={workspaceBoardOpen}
        onWorkspaceBoardDragPreviewStart={onWorkspaceBoardDragPreviewStart}
        onWorkspaceBoardDragPreviewCommit={onWorkspaceBoardDragPreviewCommit}
        onWorkspaceBoardDragPreviewCancel={onWorkspaceBoardDragPreviewCancel}
        shouldShowWorkspaceBoardDropIndicator={
          statusMutations.shouldShowWorkspaceBoardDropIndicator
        }
        onTemporarySessionDragOver={handleTemporarySessionDragOver}
        onTemporarySessionDrop={handleTemporarySessionDrop}
        onReorderWorktrees={statusMutations.reorderWorktrees}
        scrollOffsetRef={scrollOffsetRef}
        scrollAnchorRef={scrollAnchorRef}
      />
    </>
  )
})

export default WorktreeList
