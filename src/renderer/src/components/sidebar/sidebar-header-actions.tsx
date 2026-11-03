import type React from 'react'
import SidebarWorkspaceOptionsMenu from './SidebarWorkspaceOptionsMenu'

export function SidebarHeaderActions({
  onWorkspaceBoardMenuOpenChange,
  agentsViewActive = false,
  hideWorkspaceOptions = false,
  activityOptionsTarget
}: {
  onWorkspaceBoardMenuOpenChange: (open: boolean) => void
  hideWorkspaceOptions?: boolean
  agentsViewActive?: boolean
  activityOptionsTarget?: React.Ref<HTMLDivElement>
}): React.JSX.Element {
  return (
    <div className="flex shrink-0 items-center gap-1" data-sidebar-header-actions="">
      <div ref={activityOptionsTarget} className="flex size-6 shrink-0 items-center">
        {agentsViewActive || hideWorkspaceOptions ? null : (
          <SidebarWorkspaceOptionsMenu
            preserveWorkspaceBoardOpen
            onMenuOpenChange={onWorkspaceBoardMenuOpenChange}
          />
        )}
      </div>
    </div>
  )
}
