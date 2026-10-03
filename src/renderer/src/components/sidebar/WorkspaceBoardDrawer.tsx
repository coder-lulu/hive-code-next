import { Suspense, useRef, useState } from 'react'
import { ExternalLink, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { lazyWithRetry } from '@/lib/lazy-with-retry'
import { isWebClientLocation } from '@/lib/web-client-location'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { AgentDashboardSettingsMenu } from '../dashboard/AgentDashboardSettingsMenu'
import type { AgentBoardViewState } from '../dashboard-popout/AgentKanbanBoard'
import { EMPTY_DASHBOARD_FILTERS } from '../dashboard-popout/agent-board-filtering'
import WorkspaceKanbanDrawer from './WorkspaceKanbanDrawer'
import WorkspaceKanbanSheet from './WorkspaceKanbanSheet'
import { useWorkspaceKanbanOutsideDismiss } from './use-workspace-kanban-outside-dismiss'
import { useWorkspaceKanbanDrawerLingering } from './use-workspace-kanban-drawer-lingering'

const AgentDashboardPanel = lazyWithRetry(() => import('../dashboard/AgentDashboardPanel'))
type Props = React.ComponentProps<typeof WorkspaceKanbanDrawer>

export default function WorkspaceBoardDrawer(props: Props): React.JSX.Element | null {
  const lingering = useWorkspaceKanbanDrawerLingering(props.open)
  if (!props.open && !lingering) {
    return null
  }
  return <WorkspaceBoardDrawerContent {...props} />
}

function WorkspaceBoardDrawerContent(props: Props): React.JSX.Element {
  useTranslation()
  const boardRef = useRef<HTMLDivElement>(null)
  const view = useAppStore((s) => s.workspaceBoardView)
  const setView = useAppStore((s) => s.setWorkspaceBoardView)
  const sidebarOpen = useAppStore((s) => s.sidebarOpen)
  const sidebarWidth = useAppStore((s) => s.sidebarWidth)
  const activeView = props.dragPreview ? 'workspaces' : view
  const [agentViewState, setAgentViewState] = useState<AgentBoardViewState>({
    query: '',
    filters: EMPTY_DASHBOARD_FILTERS
  })
  const [workspaceQuery, setWorkspaceQuery] = useState('')
  // Reset before children render, including closes that bypass the drawer callback.
  if (!props.open) {
    if (workspaceQuery !== '') {
      setWorkspaceQuery('')
    }
    if (agentViewState.query !== '' || agentViewState.filters !== EMPTY_DASHBOARD_FILTERS) {
      setAgentViewState({ query: '', filters: EMPTY_DASHBOARD_FILTERS })
    }
  }
  const close = (): void => props.onOpenChange(false)
  useWorkspaceKanbanOutsideDismiss({ ...props, boardRef })
  return (
    <WorkspaceKanbanSheet
      {...props}
      boardRef={boardRef}
      sidebarOpen={sidebarOpen}
      sidebarWidth={sidebarWidth}
    >
      <Tabs
        value={activeView}
        onValueChange={(next) => {
          if (next !== 'workspaces' && next !== 'agents') {
            return
          }
          props.onMenuOpenChange(false)
          setView(next)
        }}
        className="min-h-0 flex-1 gap-0"
        ref={boardRef}
      >
        <SheetHeader className="flex-row items-center gap-3 border-b border-worktree-sidebar-border px-3 py-2">
          <SheetTitle className="text-sm">{translate('workspaceBoard.title', 'Board')}</SheetTitle>
          <SheetDescription className="sr-only">
            {translate(
              'workspaceBoard.description',
              'Organize workspaces and monitor agents across projects.'
            )}
          </SheetDescription>
          <TabsList className="h-7">
            <TabsTrigger value="workspaces" className="text-xs">
              {translate('workspaceBoard.workspaces', 'Workspaces')}
            </TabsTrigger>
            <TabsTrigger value="agents" className="text-xs">
              {translate('workspaceBoard.agents', 'Agents')}
            </TabsTrigger>
          </TabsList>
          <div className="ml-auto flex items-center gap-1">
            {activeView === 'agents' && (
              <>
                {!isWebClientLocation() && (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={translate('workspaceBoard.openPopout', 'Open in separate window')}
                    onClick={() => {
                      void window.api.dashboard.openPopout()
                    }}
                  >
                    <ExternalLink className="size-3.5" />
                  </Button>
                )}
                <AgentDashboardSettingsMenu onOpenChange={props.onMenuOpenChange} />
              </>
            )}
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={close}
              aria-label={translate('workspaceBoard.close', 'Close board')}
            >
              <X className="size-3.5" />
            </Button>
          </div>
        </SheetHeader>
        <TabsContent
          value="workspaces"
          className="flex min-h-0 flex-col data-[state=inactive]:hidden"
        >
          {activeView === 'workspaces' && (
            <WorkspaceKanbanDrawer
              {...props}
              onOpenChange={(open) => (open ? props.onOpenChange(true) : close())}
              searchState={{ query: workspaceQuery, onQueryChange: setWorkspaceQuery }}
            />
          )}
        </TabsContent>
        <TabsContent value="agents" className="flex min-h-0 flex-col data-[state=inactive]:hidden">
          {props.open && activeView === 'agents' && (
            <Suspense fallback={null}>
              <AgentDashboardPanel
                onClose={close}
                viewState={agentViewState}
                onViewStateChange={setAgentViewState}
              />
            </Suspense>
          )}
        </TabsContent>
      </Tabs>
    </WorkspaceKanbanSheet>
  )
}
