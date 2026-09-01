import React from 'react'
import { useAppStore } from '@/store'
import SidebarWorkspaceOptionsMenu from './SidebarWorkspaceOptionsMenu'

type SidebarHeaderProps = {
  onWorkspaceBoardMenuOpenChange: (open: boolean) => void
  /** Optional product-level title; grouping/sort controls remain unchanged. */
  sectionTitle?: string
}

const SidebarHeader = React.memo(function SidebarHeader({
  onWorkspaceBoardMenuOpenChange,
  sectionTitle
}: SidebarHeaderProps) {
  const groupBy = useAppStore((s) => s.groupBy)
  const sidebarTitle = sectionTitle ?? (groupBy === 'repo' ? 'Projects' : 'Workspaces')

  return (
    <div className="mt-2 flex h-8 items-center justify-between px-2 gap-2">
      <div className="flex min-w-0 items-center gap-1">
        <span
          className="pl-2 pr-0.5 text-xs font-semibold text-muted-foreground/80 select-none"
          data-sidebar-section-title={
            sectionTitle ? 'spaces' : groupBy === 'repo' ? 'projects' : 'workspaces'
          }
        >
          {sidebarTitle}
        </span>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <SidebarWorkspaceOptionsMenu
          preserveWorkspaceBoardOpen
          onMenuOpenChange={onWorkspaceBoardMenuOpenChange}
        />
      </div>
    </div>
  )
})

export default SidebarHeader
