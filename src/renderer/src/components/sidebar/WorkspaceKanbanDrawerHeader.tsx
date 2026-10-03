import React from 'react'
import { SheetHeader } from '@/components/ui/sheet'
import type { WorkspaceStatusDefinition } from '../../../../shared/worktree/types'
import SidebarFilter from './SidebarFilter'
import WorkspaceKanbanSearchField from './WorkspaceKanbanSearchField'
import WorkspaceKanbanSettingsMenu from './WorkspaceKanbanSettingsMenu'
import { translate } from '@/i18n/i18n'

type WorkspaceKanbanDrawerHeaderProps = {
  selectedCount: number
  query: string
  isFiltering: boolean
  isTooLarge: boolean
  matchCount: number
  totalCount: number
  onQueryChange: (query: string) => void
  onClearQuery: () => void
  workspaceStatuses: readonly WorkspaceStatusDefinition[]
  syncTaskStatusFromWorkspaceBoard: boolean
  onSyncTaskStatusFromWorkspaceBoardChange: (enabled: boolean) => void
  onRenameStatus: (statusId: string, label: string) => void
  onChangeStatusColor: (statusId: string, color: string) => void
  onChangeStatusIcon: (statusId: string, icon: string) => void
  onMoveStatus: (statusId: string, direction: -1 | 1) => void
  onRemoveStatus: (statusId: string) => void
  onAddStatus: () => void
  onFilterMenuOpenChange: (open: boolean) => void
  onClose: () => void
}

export default function WorkspaceKanbanDrawerHeader({
  selectedCount,
  query,
  isFiltering,
  isTooLarge,
  matchCount,
  totalCount,
  onQueryChange,
  onClearQuery,
  workspaceStatuses,
  syncTaskStatusFromWorkspaceBoard,
  onSyncTaskStatusFromWorkspaceBoardChange,
  onRenameStatus,
  onChangeStatusColor,
  onChangeStatusIcon,
  onMoveStatus,
  onRemoveStatus,
  onAddStatus,
  onFilterMenuOpenChange,
  onClose
}: WorkspaceKanbanDrawerHeaderProps): React.JSX.Element {
  return (
    <SheetHeader className="border-b border-worktree-sidebar-border px-3 py-2 pr-24 relative">
      <div className="flex items-center gap-2">
        <div className="flex shrink-0 items-center gap-2 text-sm">
          {selectedCount > 1 ? (
            <span className="rounded-full bg-worktree-sidebar-accent px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              {selectedCount}{' '}
              {translate(
                'auto.components.sidebar.WorkspaceKanbanDrawerHeader.81870af08f',
                'selected'
              )}
            </span>
          ) : null}
        </div>
        <WorkspaceKanbanSearchField
          query={query}
          isFiltering={isFiltering}
          isTooLarge={isTooLarge}
          matchCount={matchCount}
          totalCount={totalCount}
          onQueryChange={onQueryChange}
          onClear={onClearQuery}
          onClose={onClose}
        />
      </div>

      <div className="absolute right-3 top-2 flex items-center gap-1">
        <SidebarFilter
          preserveWorkspaceBoardOpen
          tooltipSide="top"
          contentSide="bottom"
          onMenuOpenChange={onFilterMenuOpenChange}
        />
        <WorkspaceKanbanSettingsMenu
          workspaceStatuses={workspaceStatuses}
          syncTaskStatusFromWorkspaceBoard={syncTaskStatusFromWorkspaceBoard}
          onSyncTaskStatusFromWorkspaceBoardChange={onSyncTaskStatusFromWorkspaceBoardChange}
          onRenameStatus={onRenameStatus}
          onChangeStatusColor={onChangeStatusColor}
          onChangeStatusIcon={onChangeStatusIcon}
          onMoveStatus={onMoveStatus}
          onRemoveStatus={onRemoveStatus}
          onAddStatus={onAddStatus}
        />
      </div>
    </SheetHeader>
  )
}
