import { useCallback, useEffect, useRef, useState, type ComponentProps } from 'react'
import { FolderKanban, Plus } from 'lucide-react'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import SidebarHeader from './SidebarHeader'
import WorktreeList from './WorktreeList'

export default function SidebarProjectManager(
  props: ComponentProps<typeof WorktreeList>
): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const location = useAppStore(
    (s) => `${s.activeView}|${s.activeWorkspaceExecutionHostId}|${s.activeWorkspaceKey}`
  )
  const sidebarBody = useAppStore((s) => s.sidebarBody)
  const previousBody = useRef(sidebarBody)
  const notifyWorkspaceActivated = props.onWorkspaceActivated
  const onWorkspaceActivated = useCallback(() => {
    setOpen(false)
    notifyWorkspaceActivated?.()
  }, [notifyWorkspaceActivated])
  const previousLocation = useRef(location)
  const openModal = useAppStore((s) => s.openModal)
  useEffect(() => {
    if (previousLocation.current !== location) {
      setOpen(false)
    }
    previousLocation.current = location
  }, [location])
  useEffect(() => {
    if (previousBody.current !== sidebarBody && sidebarBody === 'agents') {
      setOpen(false)
    }
    previousBody.current = sidebarBody
  }, [sidebarBody])
  return (
    <>
      <button type="button" className="session-project-heading" onClick={() => setOpen(true)}>
        <FolderKanban className="size-4 shrink-0" aria-hidden />
        <span>{translate('components.sessions.manageProjects', 'Manage projects')}</span>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex h-[80vh] min-h-0 flex-col overflow-hidden sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {translate('components.sessions.manageProjects', 'Manage projects')}
            </DialogTitle>
            <DialogDescription>
              {translate(
                'components.sessions.manageProjectsHint',
                'Manage repositories, worktrees, folders and optional groups. Open a workspace to use its development tools.'
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => openModal('add-repo')}>
              <Plus className="size-4" />
              {translate('components.sessions.addProject', 'Add project')}
            </Button>
            <Button variant="outline" size="sm" onClick={() => openModal('new-workspace-composer')}>
              <Plus className="size-4" />
              {translate('components.sessions.newWorktree', 'New worktree')}
            </Button>
          </div>
          <section
            className="sidebar-workspace-section min-h-0 flex-1 rounded-md border bg-worktree-sidebar"
            data-testid="project-manager-workspaces"
          >
            <SidebarHeader
              onWorkspaceBoardMenuOpenChange={() => {}}
              sectionTitle={translate(
                'components.sessions.workspacesAndGroups',
                'Workspaces and groups'
              )}
            />
            <WorktreeList {...props} onWorkspaceActivated={onWorkspaceActivated} />
          </section>
        </DialogContent>
      </Dialog>
    </>
  )
}
