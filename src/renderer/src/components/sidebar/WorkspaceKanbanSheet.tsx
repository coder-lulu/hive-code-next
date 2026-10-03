import React from 'react'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { isWorkspaceBoardKeepOpenTarget } from './use-workspace-kanban-outside-dismiss'
import { STATUS_BAR_RESERVE_HEIGHT, WORKSPACE_TOP_CHROME_HEIGHT } from './workspace-chrome-metrics'

type WorkspaceKanbanSheetProps = {
  boardRef: React.RefObject<HTMLDivElement | null>
  children: React.ReactNode
  dragPreview: boolean
  leftSidebarStyle?: React.CSSProperties
  onOpenChange: (open: boolean) => void
  open: boolean
  preserveOpenForMenu: boolean
  sidebarOpen: boolean
  sidebarWidth: number
  statusBarVisible: boolean
}

export default function WorkspaceKanbanSheet({
  boardRef,
  children,
  dragPreview,
  leftSidebarStyle,
  onOpenChange,
  open,
  preserveOpenForMenu,
  sidebarOpen,
  sidebarWidth,
  statusBarVisible
}: WorkspaceKanbanSheetProps): React.JSX.Element {
  const [contentLeft, setContentLeft] = React.useState<number | null>(null)
  React.useLayoutEffect(() => {
    if (!open) {
      return
    }
    const region = document.querySelector<HTMLElement>('[data-workspace-content-region]')
    if (!region) {
      return
    }
    const updateBounds = () => setContentLeft(region.getBoundingClientRect().left)
    updateBounds()
    const observer = new ResizeObserver(updateBounds)
    observer.observe(region)
    window.addEventListener('resize', updateBounds)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', updateBounds)
    }
  }, [open])
  const drawerLeft = contentLeft ?? (sidebarOpen ? sidebarWidth : 0)
  const drawerLeftCss =
    contentLeft !== null
      ? `${contentLeft}px`
      : sidebarOpen
        ? `var(--workspace-sidebar-live-width, ${sidebarWidth}px)`
        : '0px'
  const drawerBottom = `${statusBarVisible ? STATUS_BAR_RESERVE_HEIGHT : 0}px`
  const keepOpenForOutsideEvent = (event: {
    preventDefault: () => void
    detail: { originalEvent: Event }
  }): void => {
    const originalEvent = event.detail.originalEvent
    const target = originalEvent.target
    if (preserveOpenForMenu || isWorkspaceBoardKeepOpenTarget(target)) {
      event.preventDefault()
      return
    }
    const liveDrawerLeft =
      boardRef.current?.closest<HTMLElement>('[data-slot="sheet-content"]')?.getBoundingClientRect()
        .left ?? drawerLeft
    const pointerX =
      'clientX' in originalEvent && typeof originalEvent.clientX === 'number'
        ? originalEvent.clientX
        : null
    if (pointerX !== null && pointerX < liveDrawerLeft) {
      event.preventDefault()
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          onOpenChange(true)
        }
      }}
      modal={false}
    >
      <SheetContent
        side="right"
        showCloseButton={false}
        className="workspace-kanban-sheet-content bg-worktree-sidebar p-0 sm:max-w-none"
        overlayStyle={{
          top: WORKSPACE_TOP_CHROME_HEIGHT,
          bottom: drawerBottom,
          left: drawerLeftCss,
          pointerEvents: 'none'
        }}
        style={
          {
            ...leftSidebarStyle,
            left: drawerLeftCss,
            right: 0,
            top: WORKSPACE_TOP_CHROME_HEIGHT,
            bottom: drawerBottom,
            height: 'auto',
            width: 'auto'
          } as React.CSSProperties
        }
        data-contextual-tour-target="workspace-board-surface"
        data-workspace-board-sheet=""
        data-workspace-board-drag-preview={dragPreview ? 'true' : undefined}
        onOpenAutoFocus={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => event.preventDefault()}
        onPointerDownOutside={keepOpenForOutsideEvent}
        onInteractOutside={keepOpenForOutsideEvent}
      >
        {children}
      </SheetContent>
    </Sheet>
  )
}
