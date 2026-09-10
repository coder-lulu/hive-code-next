import { Suspense, useRef } from 'react'
import { lazyWithRetry as lazy } from '@/lib/lazy-with-retry'
import { translate } from '@/i18n/i18n'
import { APP_DISPLAY_NAME } from '@/product-brand'
import Sidebar from '../components/Sidebar'
import { useWorkspaceRevealBodyRedirect } from '../components/sidebar/use-workspace-reveal-body-redirect'
import RightSidebar from '../components/right-sidebar'
import { RecoverableRenderErrorBoundary } from '../components/error-boundaries/RecoverableRenderErrorBoundary'
import { FloatingTerminalToggleButton } from '../components/floating-terminal/FloatingTerminalToggleButton'
import { SidebarSettingsHelpMenu } from '../components/sidebar/SidebarSettingsHelpMenu'
import { TerminalWorkbenchContainer } from '../components/TerminalWorkbenchContainer'
import type { VirtualizedScrollAnchor } from '../hooks/useVirtualizedScrollAnchor'
import {
  useWorkspaceBoardPanel,
  type WorkspaceBoardPanelState
} from '../components/sidebar/useWorkspaceBoardPanel'
import { TitlebarLeftControls } from './TitlebarLeftControls'
import { RightSidebarToggle, TitlebarMainStrip } from './TitlebarMainStrip'
import type { AppChromeLayout } from './use-app-chrome-layout'
import type { FloatingWorkspacePanelState } from './use-floating-workspace-panel'
import { resolveSettingsHelpPlacement } from './titlebar-settings-help-placement'
import { AppPageLoadingFallback } from './AppPageLoadingFallback'
import { useAppStore } from '../store'
import { loadSettingsPage } from '../components/settings/settings-page-loader'

const Landing = lazy(() => import('../components/Landing'))
const WorktreeCreationPanel = lazy(
  () => import('../components/worktree-creation/WorktreeCreationPanel')
)
const TaskPage = lazy(() => import('../components/task-page/TaskPage'))
const ProjectWorkspaceNavigation = lazy(
  () => import('../components/sessions/ProjectWorkspaceNavigation')
)
const SessionsPage = lazy(() => import('../components/sessions/SessionsPage'))
const AutomationsPage = lazy(() => import('../components/automations/AutomationsPage'))
const ActivityPrototypePage = lazy(() => import('../components/activity/ActivityPrototypePage'))
const TemporarySessionsActivityView = lazy(
  () => import('../components/activity/TemporarySessionsActivityView')
)
const Settings = lazy(loadSettingsPage, { reloadKey: 'settings' })
const SkillsPage = lazy(() => import('../components/skills/SkillsPage'))
const ArtifactsPage = lazy(() => import('../components/artifacts/ArtifactsPage'))
const WorkspaceSpacePage = lazy(() => import('../components/workspace-space/WorkspaceSpacePage'))
const MobilePage = lazy(() => import('../components/mobile/MobilePage'))
const Terminal = lazy(() => import('../components/Terminal'))

type WorktreeSidebarScrollRefs = {
  scrollOffsetRef: React.MutableRefObject<number>
  scrollAnchorRef: React.MutableRefObject<VirtualizedScrollAnchor>
}

function WorktreeSidebar({
  layout,
  scrollRefs,
  workspaceBoardPanel
}: {
  layout: AppChromeLayout
  scrollRefs: WorktreeSidebarScrollRefs
  workspaceBoardPanel: WorkspaceBoardPanelState
}): React.JSX.Element {
  return (
    <RecoverableRenderErrorBoundary
      boundaryId="sidebar.worktrees"
      surface="sidebar"
      resetKey={layout.activeView}
      title={translate('auto.App.1468601e7b', 'The workspace list hit an error.')}
      description={
        layout.leftTitlebarChromeLayout.shouldMount
          ? translate(
              'auto.App.bdc71dddc9',
              'The active workspace remains open. Retry the list or switch views.'
            )
          : translate(
              'auto.App.cba0fafda5',
              'The active page remains open. Retry the list or switch views.'
            )
      }
    >
      <Sidebar
        worktreeScrollOffsetRef={scrollRefs.scrollOffsetRef}
        worktreeScrollAnchorRef={scrollRefs.scrollAnchorRef}
        workspaceBoardPanel={workspaceBoardPanel}
      />
    </RecoverableRenderErrorBoundary>
  )
}

function ActivePage({ layout }: { layout: AppChromeLayout }): React.JSX.Element {
  const { activeView, activeWorktreeId, activePendingCreationId, creationLayoutActive } = layout
  const projectNavigation = useAppStore((s) => s.sessionsView.navigation === 'projects')
  const activityPageScope = useAppStore((state) => state.activityPageScope)
  return (
    <>
      {activeView === 'settings' ? <Settings /> : null}
      {activeView === 'skills' ? <SkillsPage /> : null}
      {activeView === 'artifacts' ? <ArtifactsPage /> : null}
      {activeView === 'tasks' ? <TaskPage /> : null}
      {activeView === 'sessions' && !projectNavigation ? (
        <SessionsPage reserveTopChrome={layout.stackedSidebarOpen} />
      ) : null}
      {activeView === 'automations' ? <AutomationsPage /> : null}
      {activeView === 'activity' ? (
        activityPageScope === 'temporary-sessions' ? (
          <TemporarySessionsActivityView />
        ) : (
          <ActivityPrototypePage />
        )
      ) : null}
      {activeView === 'space' ? <WorkspaceSpacePage /> : null}
      {activeView === 'mobile' ? <MobilePage /> : null}
      {activeView === 'terminal' && creationLayoutActive && activePendingCreationId ? (
        <WorktreeCreationPanel
          creationId={activePendingCreationId}
          reserveCollapsedSidebarHeaderSpace={layout.leftTitlebarChromeLayout.isFloating}
        />
      ) : null}
      {activeView === 'terminal' && !activeWorktreeId && !creationLayoutActive ? <Landing /> : null}
    </>
  )
}

/** The left sidebar + titlebar + page/workbench content area + right sidebar. */
export function AppWorkspaceShell(props: {
  layout: AppChromeLayout
  floatingWorkspace: FloatingWorkspacePanelState
}): React.JSX.Element {
  const { layout, floatingWorkspace } = props
  useWorkspaceRevealBodyRedirect()
  const projectNavigation = useAppStore(
    (s) =>
      s.sessionsView.navigation === 'projects' &&
      (s.activeView === 'sessions' ||
        (s.activeView === 'terminal' && Boolean(s.activeWorktreeId || s.activePendingCreationId)))
  )
  const mandatoryUpdate = useAppStore((state) => state.updateStatus.mandatory === true)
  const workspaceBoardPanel = useWorkspaceBoardPanel()
  const stackedMainStripMounted =
    layout.stackedSidebarOpen &&
    layout.activeView !== 'sessions' &&
    layout.activeView !== 'automations' &&
    layout.activeView !== 'artifacts'
  const settingsHelpPlacement = resolveSettingsHelpPlacement({
    creationLayoutActive: layout.creationLayoutActive,
    mainStripMounted: !layout.leftTitlebarChromeLayout.shouldMount || stackedMainStripMounted,
    workspaceChromeActive: layout.workspaceChromeActive,
    rightSidebarVisible: layout.showRightSidebarControls && layout.rightSidebarOpen
  })
  const titlebarLeftControls = <TitlebarLeftControls layout={layout} />
  const titlebarMainStrip = (
    <TitlebarMainStrip
      layout={layout}
      showSettingsHelpControls={settingsHelpPlacement === 'main-strip'}
    />
  )
  // Why: keep virtualized scroll memory above the sidebar's workspace/landing remount so the left list doesn't restart at scrollTop 0.
  const scrollOffsetRef = useRef(0)
  const scrollAnchorRef = useRef<VirtualizedScrollAnchor>(null)
  const sidebarScrollRefs = { scrollOffsetRef, scrollAnchorRef }

  return (
    // Why: workspace activation is a hot path; activeWorktreeId in reset keys would remount whole surfaces during wake.
    <RecoverableRenderErrorBoundary
      boundaryId="app.workspace-shell"
      surface="workspace-shell"
      resetKey={layout.activeView}
      title={translate('auto.App.df1d56bf87', 'The workspace shell hit an error.')}
      description={translate(
        'auto.App.8504ddf267',
        'The app is still running. Retry the shell or use the menu to report the crash details.'
      )}
    >
      <div
        className="flex flex-row flex-1 min-h-0 overflow-hidden"
        inert={mandatoryUpdate || undefined}
        aria-hidden={mandatoryUpdate || undefined}
      >
        {/* Why: keep the non-workspace titlebar inside this left+center wrapper so it doesn't span over the right-sidebar column. */}
        <div className="flex flex-col flex-1 min-w-0 min-h-0">
          {/* Why: workspace view drops the full-width titlebar so tab groups extend to the top; settings/landing/tasks keep it. */}
          {!layout.leftTitlebarChromeLayout.shouldMount ? (
            <div className="titlebar">
              <div className="flex items-center shrink-0 mr-2">{titlebarLeftControls}</div>
              {titlebarMainStrip}
            </div>
          ) : null}
          <div className="flex flex-row flex-1 min-h-0 overflow-hidden">
            {layout.showSidebar ? (
              layout.leftTitlebarChromeLayout.shouldMount ? (
                /* Why: when the sidebar is collapsed, take this titlebar-height header out of flex layout so the terminal/editor reclaim the left edge. */
                <div
                  className={`flex min-h-0 flex-col shrink-0${layout.sidebarOpen ? '' : ' relative w-0 overflow-visible'}`}
                >
                  <div
                    // Why: floating titlebar-left occludes the center column's border-l seam; border-r restores that line, w-max sizes it to its own controls.
                    className={`titlebar-left${
                      layout.leftTitlebarChromeLayout.isFloating
                        ? ' titlebar-left-floating absolute top-0 left-0 z-10 w-max border-r border-border'
                        : ''
                    }`}
                    style={{
                      // Why: custom sidebar appearances are scoped to the sidebar root; mirror those vars onto the header in the same left-column panel.
                      ...(layout.sidebarOpen ? layout.leftSidebarStyle : undefined),
                      // Why: size from the wrapper's live width so the header tracks in-flight drag resizes (persisted to Zustand only on mouseup).
                      width: layout.sidebarOpen ? '100%' : undefined
                    }}
                  >
                    {titlebarLeftControls}
                  </div>
                  {/* Why: flex-1/min-h-0 slot needed under the fixed 36px header, else the sidebar collapses to content height and loses its scroll viewport. */}
                  <div className="flex min-h-0 flex-1">
                    <WorktreeSidebar
                      layout={layout}
                      scrollRefs={sidebarScrollRefs}
                      workspaceBoardPanel={workspaceBoardPanel}
                    />
                  </div>
                </div>
              ) : (
                <WorktreeSidebar
                  layout={layout}
                  scrollRefs={sidebarScrollRefs}
                  workspaceBoardPanel={workspaceBoardPanel}
                />
              )
            ) : null}
            {projectNavigation && (
              <Suspense fallback={<AppPageLoadingFallback />}>
                <ProjectWorkspaceNavigation workspaceBoardPanel={workspaceBoardPanel} />
              </Suspense>
            )}
            <div
              data-workspace-content-region
              className="flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden"
            >
              {/* Why: automations/artifacts own their page headers; the stacked titlebar would be an empty 36px stripe. */}
              {stackedMainStripMounted ? <div className="titlebar">{titlebarMainStrip}</div> : null}
              <div
                className={`relative flex flex-1 min-w-0 min-h-0 overflow-hidden${
                  settingsHelpPlacement === 'shell-overlay' ? ' shell-overlay-chrome-active' : ''
                }`}
              >
                {/* Why: match the RightSidebar header's 36px/top-0 so the toggle's vertical center is identical open vs closed — else the icon jitters. */}
                {settingsHelpPlacement === 'shell-overlay' && (
                  <div
                    className="absolute top-0 z-10 flex items-center h-[36px]"
                    style={
                      {
                        // Why: --window-controls-width keeps the toggle clear of the fixed window-controls overlay (138px on custom chrome, 0px otherwise); no internal spacer — one would cover the pane-actions Ellipsis button with an unclickable div.
                        right: 'var(--window-controls-width)',
                        WebkitAppRegion: 'no-drag'
                      } as React.CSSProperties
                    }
                  >
                    <SidebarSettingsHelpMenu />
                    {layout.showRightSidebarControls ? <RightSidebarToggle /> : null}
                  </div>
                )}
                <div className="flex flex-1 min-w-0 min-h-0 flex-col">
                  {layout.shouldMountTerminalWorkbench ? (
                    <TerminalWorkbenchContainer isVisible={layout.terminalWorkbenchVisible}>
                      <Suspense fallback={null}>
                        <RecoverableRenderErrorBoundary
                          boundaryId="terminal.workbench"
                          surface="terminal-workbench"
                          resetKey="terminal"
                          title={translate(
                            'auto.App.5a9519aef0',
                            'The workspace workbench hit an error.'
                          )}
                          description={translate(
                            'auto.App.98d4ea2823',
                            'Terminal, browser, or editor rendering failed in this workspace. Retry to remount it.'
                          )}
                        >
                          <Terminal />
                        </RecoverableRenderErrorBoundary>
                      </Suspense>
                    </TerminalWorkbenchContainer>
                  ) : null}
                  <Suspense fallback={<AppPageLoadingFallback />}>
                    <RecoverableRenderErrorBoundary
                      boundaryId={`page.${layout.activeView}`}
                      surface="page"
                      resetKey={layout.activeView}
                      title={translate('auto.App.b7a714db1e', 'This page hit an error.')}
                      description={translate(
                        'auto.App.03a14f6b5b',
                        'Retry the page or navigate to another {{value0}} page.',
                        { value0: APP_DISPLAY_NAME }
                      )}
                    >
                      {projectNavigation && layout.activeView === 'sessions' ? (
                        <section
                          className="session-detail session-detail-empty"
                          data-testid="project-workspace-empty"
                        >
                          <h2>
                            {translate('components.sessions.chooseWorkspace', 'Select a workspace')}
                          </h2>
                        </section>
                      ) : (
                        <ActivePage layout={layout} />
                      )}
                    </RecoverableRenderErrorBoundary>
                  </Suspense>
                </div>
                {floatingWorkspace.showToggleButton && layout.activeView !== 'sessions' ? (
                  <FloatingTerminalToggleButton
                    open={floatingWorkspace.open}
                    onToggle={() => floatingWorkspace.setOpenWithFocus((open) => !open)}
                  />
                ) : null}
              </div>
            </div>
          </div>
        </div>
        {/* Why: keep the shell mounted for layout stability (heavy panels disconnect while closed); unmount on the distraction-free tasks view. */}
        {layout.showRightSidebarControls ? (
          <RecoverableRenderErrorBoundary
            boundaryId="right-sidebar"
            surface="right-sidebar"
            resetKey={
              layout.rightSidebarTab === 'explorer'
                ? `${layout.rightSidebarTab}:${layout.rightSidebarExplorerView}`
                : layout.rightSidebarTab
            }
            title={translate('auto.App.ed6b168d00', 'The right sidebar hit an error.')}
            description={translate(
              'auto.App.8d1e160ed1',
              'Retry the sidebar or switch tabs to reload this surface.'
            )}
          >
            <RightSidebar showSettingsHelpControls={settingsHelpPlacement === 'right-sidebar'} />
          </RecoverableRenderErrorBoundary>
        ) : null}
      </div>
    </RecoverableRenderErrorBoundary>
  )
}
