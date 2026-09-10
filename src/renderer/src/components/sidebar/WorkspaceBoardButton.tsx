import React from 'react'
import { Kanban } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import type { WorkspaceBoardPanelState } from './useWorkspaceBoardPanel'

export const WorkspaceBoardButton = React.memo(function WorkspaceBoardButton({
  workspaceBoardPanel
}: {
  workspaceBoardPanel: WorkspaceBoardPanelState
}) {
  useTranslation()
  return (
    <div className="right-sidebar-header-no-drag flex items-center gap-0.5">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={
              workspaceBoardPanel.workspaceBoardOpen ||
              workspaceBoardPanel.workspaceBoardDragPreviewOpen
                ? 'secondary'
                : 'ghost'
            }
            size="icon-xs"
            type="button"
            aria-label={translate(
              'auto.components.sidebar.SidebarToolbar.49f62c5665',
              'Workspace board'
            )}
            aria-pressed={workspaceBoardPanel.workspaceBoardOpen}
            data-workspace-board-trigger=""
            data-workspace-board-preview={
              workspaceBoardPanel.workspaceBoardDragPreviewOpen ? 'true' : undefined
            }
            onClick={workspaceBoardPanel.toggleWorkspaceBoard}
            className="text-muted-foreground"
          >
            <Kanban className="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent
          side="bottom"
          sideOffset={6}
          className="border border-border bg-popover text-popover-foreground shadow-md"
        >
          {workspaceBoardPanel.workspaceBoardOpen
            ? translate(
                'auto.components.sidebar.SidebarToolbar.a30e34eb5c',
                'Close workspace board'
              )
            : translate('auto.components.sidebar.SidebarToolbar.49f62c5665', 'Workspace board')}
        </TooltipContent>
      </Tooltip>
    </div>
  )
})
