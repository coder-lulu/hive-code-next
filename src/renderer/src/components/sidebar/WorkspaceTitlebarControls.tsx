import React from 'react'
import { Kanban } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { hasFeatureInteraction } from '../../../../shared/feature-interactions'
import { ScrollToCurrentWorkspaceToolbarButton } from './ScrollToCurrentWorkspaceToolbarButton'
import type { WorkspaceBoardPanelState } from './useWorkspaceBoardPanel'

const WORKSPACE_BOARD_MOVED_HINT_STORAGE_KEY = 'orca.workspaceBoardMovedHintSeen.v2'
const WORKSPACE_BOARD_MOVED_HINT_DURATION_MS = 12000

export const WorkspaceTitlebarControls = React.memo(function WorkspaceTitlebarControls({
  workspaceBoardPanel
}: {
  workspaceBoardPanel: WorkspaceBoardPanelState
}) {
  useTranslation()
  const [movedHintOpen, setMovedHintOpen] = React.useState(false)
  const movedHintEligibleRef = React.useRef<boolean | null>(null)
  const persistedUIReady = useAppStore((state) => state.persistedUIReady)
  const hasUsedWorkspaceBoard = useAppStore((state) =>
    hasFeatureInteraction(state.featureInteractions, 'workspace-board')
  )

  React.useEffect(() => {
    if (!persistedUIReady) {
      return
    }
    if (movedHintEligibleRef.current === null) {
      movedHintEligibleRef.current = hasUsedWorkspaceBoard
    }
    if (!movedHintEligibleRef.current) {
      return
    }
    try {
      if (window.localStorage.getItem(WORKSPACE_BOARD_MOVED_HINT_STORAGE_KEY) === 'true') {
        return
      }
      window.localStorage.setItem(WORKSPACE_BOARD_MOVED_HINT_STORAGE_KEY, 'true')
    } catch {
      return
    }

    setMovedHintOpen(true)
    const timeoutId = window.setTimeout(
      () => setMovedHintOpen(false),
      WORKSPACE_BOARD_MOVED_HINT_DURATION_MS
    )
    return () => window.clearTimeout(timeoutId)
  }, [hasUsedWorkspaceBoard, persistedUIReady])

  const handleWorkspaceBoardClick = (): void => {
    setMovedHintOpen(false)
    workspaceBoardPanel.toggleWorkspaceBoard()
  }

  return (
    <div className="right-sidebar-header-no-drag flex items-center gap-0.5">
      <ScrollToCurrentWorkspaceToolbarButton tooltipSide="bottom" />
      <Tooltip open={movedHintOpen ? true : undefined}>
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
            onClick={handleWorkspaceBoardClick}
            className="text-muted-foreground"
          >
            <Kanban className="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={6}>
          {movedHintOpen
            ? translate(
                'auto.components.sidebar.SidebarToolbar.87d0064026',
                'Workspace board moved to the top bar'
              )
            : workspaceBoardPanel.workspaceBoardOpen
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
