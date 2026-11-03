import {
  OpenWorkspaceInSurfaceContext,
  type OpenWorkspaceInSurface
} from './worktree-list/navigation/workspace-activation-context'
import { filterProjectTreeRows } from './worktree-list/listing/project-tree-search'
import type { ExecutionHostId } from '../../../../shared/execution-host'
import React, { useCallback, useMemo, useState } from 'react'
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
import { getHeaderCreateWorkspaceTarget } from './header-create-workspace-target'
import {
  getRepoExecutionHostId,
  getSettingsFocusedExecutionHostId
} from '../../../../shared/execution-host'
import { getActiveSidebarWorkspaceId } from '../../../../shared/workspace-scope'
import { getPinnedWorktreeDisplayPolicy } from '../../../../shared/sidebar-list/row-types'
import { selectWorktreeListReviewCacheInputs } from './worktree-list/listing/review-cache-inputs'
import type { VirtualizedScrollAnchor } from '@/hooks/useVirtualizedScrollAnchor'
import { SidebarWorktreeListDialogs } from './worktree-list/rows/ProjectGroupDialogs'
import { SidebarWorktreeListEmptyState } from './worktree-list/listing/EmptyState'
import { VirtualizedWorktreeViewport } from './worktree-list/viewport/VirtualizedWorktreeViewport'
import { markSidebarWorktreeActiveImmediately } from './worktree-list/rows/option-dom'
import { EMPTY_PROJECT_GROUPS } from './worktree-list/viewport/viewport-props'
import { NOOP_WORKSPACE_BOARD_DRAG_PREVIEW_CALLBACK } from './worktree-list/drag/drop-commit-context'
import { useAgentSendTargetWorktreeId } from './worktree-list/listing/use-agent-send-target'
import { useProjectGroupDialogs } from './worktree-list/rows/use-project-group-dialogs'
import { useSidebarRevealRequests } from './worktree-list/navigation/use-reveal-requests'
import { useSidebarWorktreeFilters } from './worktree-list/listing/use-filters'
import { useSidebarWorktreeSelection } from './worktree-list/navigation/use-selection'
import { useWindowSidebarListModel } from './worktree-list/listing/use-window-list-model'
import { useMainSidebarListModel } from './worktree-list/listing/use-main-list-model'
import { isPairedWebClientWindow } from '@/lib/desktop-window-chrome'
import { ORCA_SIDEBAR_INPUTS_IS_MAIN } from '../../../../shared/sidebar-inputs-switch'
import { useWorktreeStatusMutations } from './worktree-list/drag/use-status-mutations'
import { shouldFiltersHideAllRows } from './sidebar-empty-state-gate'
import { buildWorktreeManualOrderCatalog } from './worktree-manual-order-catalog'
import { useWorkspaceBoardStatuses } from './use-workspace-board-statuses'
import {
  selectDetectedWorktreesByRepo,
  selectFolderWorkspaces
} from '@/store/workspace-record-selectors'

const SEARCH_EXPANDED_GROUPS = new Set<string>()

type WorktreeListProps = {
  projectHierarchy?: boolean
  searchQuery?: string
  onOpenWorkspace?: OpenWorkspaceInSurface
  selectedWorkspace?: { worktreeId: string; executionHostId: ExecutionHostId } | null
  scrollOffsetRef: React.MutableRefObject<number>
  scrollAnchorRef: React.MutableRefObject<VirtualizedScrollAnchor>
  workspaceBoardOpen?: boolean
  onWorktreeCardClick?: () => void
  onWorkspaceBoardDragPreviewStart?: () => void
  onWorkspaceBoardDragPreviewCommit?: () => void
  onWorkspaceBoardDragPreviewCancel?: () => void
}

// Desktop windows consume main’s sidebar inputs; paired web clients derive their own view.
const useSidebarListModel =
  ORCA_SIDEBAR_INPUTS_IS_MAIN && !isPairedWebClientWindow()
    ? useMainSidebarListModel
    : useWindowSidebarListModel

const WorktreeList = React.memo(function WorktreeList({
  scrollOffsetRef,
  scrollAnchorRef,
  projectHierarchy = false,
  searchQuery = '',
  selectedWorkspace,
  onOpenWorkspace,
  workspaceBoardOpen = false,
  onWorktreeCardClick,
  onWorkspaceBoardDragPreviewStart = NOOP_WORKSPACE_BOARD_DRAG_PREVIEW_CALLBACK,
  onWorkspaceBoardDragPreviewCommit = NOOP_WORKSPACE_BOARD_DRAG_PREVIEW_CALLBACK,
  onWorkspaceBoardDragPreviewCancel = NOOP_WORKSPACE_BOARD_DRAG_PREVIEW_CALLBACK
}: WorktreeListProps) {
  const allWorktrees = useAllWorktrees()
  const repoMap = useRepoMap()
  const worktreeMap = useWorktreeMap()
  const repos = useAppStore((s) => s.repos)
  const worktreeLineageById = useAppStore((s) => s.worktreeLineageById)
  const workspaceLineageByChildKey = useAppStore((s) => s.workspaceLineageByChildKey)
  const detectedWorktreesByRepo = useAppStore((s) => selectDetectedWorktreesByRepo(s))
  const storedWorktreeId = useAppStore((s) => s.activeWorktreeId)
  const activeWorktreeId =
    selectedWorkspace !== undefined ? (selectedWorkspace?.worktreeId ?? null) : storedWorktreeId
  const storedHostId = useAppStore((s) => s.activeWorkspaceExecutionHostId)
  const activeWorkspaceExecutionHostId =
    selectedWorkspace !== undefined ? (selectedWorkspace?.executionHostId ?? null) : storedHostId
  const storedWorkspaceKey = useAppStore((s) => s.activeWorkspaceKey)
  const activeWorkspaceKey = selectedWorkspace !== undefined ? null : storedWorkspaceKey
  const currentSidebarWorktreeId = useMemo(
    () => getActiveSidebarWorkspaceId(activeWorkspaceKey, activeWorktreeId),
    [activeWorkspaceKey, activeWorktreeId]
  )
  const storedGroupBy = useAppStore((s) => s.groupBy)
  const groupBy = projectHierarchy ? 'repo' : storedGroupBy
  const boardStatuses = useWorkspaceBoardStatuses()
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
  const toggleStoredGroup = useAppStore((s) => s.toggleCollapsedGroup)
  const [searchDisclosure, setSearchDisclosure] = useState({
    query: '',
    collapsed: new Set<string>()
  })
  const searching = searchQuery.trim() !== ''
  const searchCollapsed =
    searchDisclosure.query === searchQuery ? searchDisclosure.collapsed : SEARCH_EXPANDED_GROUPS
  const toggleGroup = useCallback(
    (key: string) => {
      if (!searching) {
        toggleStoredGroup(key)
        return
      }
      setSearchDisclosure((previous) => {
        const collapsed = new Set(previous.query === searchQuery ? previous.collapsed : [])
        if (collapsed.has(key)) {
          collapsed.delete(key)
        } else {
          collapsed.add(key)
        }
        return { query: searchQuery, collapsed }
      })
    },
    [searchQuery, searching, toggleStoredGroup]
  )
  const projectGroups = useAppStore((s) => s.projectGroups ?? EMPTY_PROJECT_GROUPS)
  const folderWorkspaces = useAppStore((s) => selectFolderWorkspaces(s))
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
  const { filterState, hasFilters, clearFilters, revealWorkspaceFilters } =
    useSidebarWorktreeFilters()
  const manualOrderCatalog = useMemo(
    () => buildWorktreeManualOrderCatalog({ worktrees: allWorktrees, folderWorkspaces }),
    [allWorktrees, folderWorkspaces]
  )
  const { visibleWorktrees, visibleScope, externalWorktreeCards, rowModel } = useSidebarListModel({
    filterState,
    sortBy,
    groupBy,
    projectOrderBy,
    pinnedDisplayPolicy,
    defaultHostId,
    workspaceStatuses: boardStatuses,
    settings,
    collapsedGroups: searching ? SEARCH_EXPANDED_GROUPS : collapsedGroups,
    repos,
    repoMap,
    allWorktrees,
    worktreeMap,
    worktreeLineageById,
    projectGroups,
    folderWorkspaces,
    projectGrouping,
    detectedWorktreesByRepo,
    prCache,
    agentSendTargetWorktreeId
  })
  const visibleProjectRepoIdsBySection = useMemo(
    () => new Map(rowModel.occurrencePlan.sections.map(({ key, group }) => [key, group.repoIds])),
    [rowModel.occurrencePlan]
  )
  const sectionRows = useMemo(
    () => filterProjectTreeRows(rowModel.sectionRows, searchQuery, searchCollapsed),
    [rowModel.sectionRows, searchQuery, searchCollapsed]
  )
  const effectiveCollapsedGroups = searching ? searchCollapsed : rowModel.effectiveCollapsedGroups
  const selection = useSidebarWorktreeSelection({
    sectionRows,
    pinnedDisplayPolicy
  })
  const statusMutations = useWorktreeStatusMutations({
    manualOrderCatalog,
    workspaceStatuses: boardStatuses,
    sortBy
  })
  const projectGroupDialogs = useProjectGroupDialogs({ repos, repoMap, projectGroups })

  const handleImmediateWorktreeActivate = useCallback((worktreeId: string, rowKey?: string) => {
    // Update the active row directly on pointer input to avoid virtualized rerender latency; store state reconciles afterward.
    markSidebarWorktreeActiveImmediately(worktreeId, rowKey)
  }, [])

  const handleCreateForRepo = useCallback(
    (repo: Repo, { pinHost }: { pinHost: boolean }) => {
      const { repos, projectHostSetups } = useAppStore.getState()
      openModal('new-workspace-composer', {
        initialRepoId: repo.id,
        ...(pinHost ? getHeaderCreateWorkspaceTarget(repo, repos, projectHostSetups) : {}),
        telemetrySource: 'sidebar'
      })
    },
    [openModal]
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

  useSidebarRevealRequests({
    groupBy,
    renderedSidebarRowKeys: rowModel.renderedSidebarRowKeys,
    visibleWorktrees,
    visibleFolderWorkspaces: visibleScope.visibleFolderWorkspacesForRows,
    currentSidebarWorktreeId,
    currentSidebarExecutionHostId: activeWorkspaceExecutionHostId,
    worktreeMap,
    worktrees: allWorktrees,
    folderWorkspaces,
    hasFilters,
    revealWorkspaceFilters
  })

  const filtersHideAllRows = shouldFiltersHideAllRows({
    hasFilters,
    visibleWorktreeCount: visibleWorktrees.length,
    visibleFolderWorkspaceCount: visibleScope.visibleFolderWorkspacesForRows.length,
    placeholderRepoCount: rowModel.placeholderRepoIds.size,
    importedWorktreeCardCount: externalWorktreeCards.importedWorktreesByRepo.size
  })
  // Clear Filters must outrank empty project headers when filtering hides every workspace.
  if (sectionRows.length === 0 || filtersHideAllRows) {
    return <SidebarWorktreeListEmptyState hasFilters={hasFilters} onClearFilters={clearFilters} />
  }

  return (
    <OpenWorkspaceInSurfaceContext.Provider value={onOpenWorkspace}>
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
        // Wake moves status headers; preserve viewport identity across those changes.
        key={`group:${groupBy}:host:${filterState.visibleWorkspaceHostIds?.join(',') ?? 'all'}:lineage`}
        rows={sectionRows}
        hostOptions={rowModel.hostOptions}
        occurrencePlan={rowModel.occurrencePlan}
        visibleProjectRepoIdsBySection={visibleProjectRepoIdsBySection}
        // Full-page Tasks/Activity views have no selected worktree card.
        activeWorktreeId={
          selectedWorkspace === undefined && (activeView === 'tasks' || activeView === 'activity')
            ? null
            : currentSidebarWorktreeId
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
        workspaceStatuses={boardStatuses}
        projectGrouping={projectGrouping}
        projectGroups={projectGroups}
        visibleProjectGroups={visibleScope.visibleProjectGroupsForRows}
        onMoveWorktreeToStatus={statusMutations.moveWorktreeToStatus}
        onMoveWorktreesToStatus={statusMutations.moveWorktreesToStatus}
        onMoveWorktreesToStatusAtIndex={statusMutations.moveWorktreesToStatusAtIndex}
        onPinWorktree={statusMutations.pinWorktree}
        onPinWorktrees={statusMutations.pinWorktrees}
        onDropWorktreesOnWorkspaceBoard={statusMutations.dropWorktreesOnWorkspaceBoard}
        workspaceBoardOpen={workspaceBoardOpen}
        onWorktreeCardClick={onWorktreeCardClick}
        onWorkspaceBoardDragPreviewStart={onWorkspaceBoardDragPreviewStart}
        onWorkspaceBoardDragPreviewCommit={onWorkspaceBoardDragPreviewCommit}
        onWorkspaceBoardDragPreviewCancel={onWorkspaceBoardDragPreviewCancel}
        shouldShowWorkspaceBoardDropIndicator={
          statusMutations.shouldShowWorkspaceBoardDropIndicator
        }
        onReorderWorktrees={statusMutations.reorderWorktrees}
        scrollOffsetRef={scrollOffsetRef}
        scrollAnchorRef={scrollAnchorRef}
      />
    </OpenWorkspaceInSurfaceContext.Provider>
  )
})

export default WorktreeList
