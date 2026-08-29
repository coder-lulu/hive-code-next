import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowRight, Bot, FileCode2, FolderGit2, GitBranch, PanelRight, Play } from 'lucide-react'
import { useAppStore } from '@/store'
import { useSidebarResize } from '@/hooks/useSidebarResize'
import { activateAndRevealWorkspace } from '@/lib/worktree-activation'
import {
  buildDesktopHomeModel,
  formatHomeRelativeTime
} from '@/components/landing/desktop-home-model'
import type { HomeRelativeTimeLabels } from '@/components/landing/desktop-home-model'
import { translate } from '@/i18n/i18n'
import { SidebarSettingsHelpMenu } from '@/components/sidebar/SidebarSettingsHelpMenu'
import { useWindowWidth } from './use-window-width'
import {
  RIGHT_SIDEBAR_MIN_WIDTH,
  clampRightSidebarPanelWidth,
  computeMaxRightSidebarPanelWidth
} from './right-sidebar-width'

export function LandingContextSidebar({
  showSettingsHelpControls = false
}: {
  showSettingsHelpControls?: boolean
}): React.JSX.Element {
  useTranslation()
  const rightSidebarOpen = useAppStore((state) => state.rightSidebarOpen)
  const rightSidebarWidth = useAppStore((state) => state.rightSidebarWidth)
  const setRightSidebarWidth = useAppStore((state) => state.setRightSidebarWidth)
  const toggleRightSidebar = useAppStore((state) => state.toggleRightSidebar)
  const repos = useAppStore((state) => state.repos)
  const worktreesByRepo = useAppStore((state) => state.worktreesByRepo)
  const tabsByWorktree = useAppStore((state) => state.tabsByWorktree)
  const openFiles = useAppStore((state) => state.openFiles)
  const openModal = useAppStore((state) => state.openModal)
  const model = useMemo(
    () => buildDesktopHomeModel({ repos, worktreesByRepo, tabsByWorktree, openFiles }),
    [openFiles, repos, tabsByWorktree, worktreesByRepo]
  )
  const windowWidth = useWindowWidth()
  const renderedWidth = clampRightSidebarPanelWidth(rightSidebarWidth, windowWidth, 0)
  const { containerRef, onResizeStart } = useSidebarResize<HTMLDivElement>({
    isOpen: rightSidebarOpen,
    width: renderedWidth,
    minWidth: RIGHT_SIDEBAR_MIN_WIDTH,
    maxWidth: computeMaxRightSidebarPanelWidth(windowWidth, 0),
    deltaSign: -1,
    setWidth: setRightSidebarWidth
  })
  const workspace = model.currentWorkspace
  const timeLabels: HomeRelativeTimeLabels = {
    unused: translate('components.desktopHome.time.unused', 'Not used yet'),
    justNow: translate('components.desktopHome.time.justNow', 'Just now'),
    minutesAgo: (value) =>
      translate('components.desktopHome.time.minutesAgo', '{{value}} min ago', { value }),
    hoursAgo: (value) =>
      translate('components.desktopHome.time.hoursAgo', '{{value}} hr ago', { value }),
    daysAgo: (value) =>
      translate('components.desktopHome.time.daysAgo', '{{value}} days ago', { value })
  }

  return (
    <aside
      ref={containerRef}
      className={`landing-context-sidebar${rightSidebarOpen ? ' is-open' : ''}`}
      aria-label={translate('components.landingContext.currentContext', 'Current context')}
    >
      {rightSidebarOpen ? (
        <>
          <header className="landing-context-header right-sidebar-header-inset right-sidebar-header-drag">
            <span>{translate('components.landingContext.currentContext', 'Current context')}</span>
            <div className="flex shrink-0 items-center gap-1">
              {showSettingsHelpControls ? <SidebarSettingsHelpMenu /> : null}
              <button
                type="button"
                className="sidebar-toggle"
                onClick={toggleRightSidebar}
                aria-label={translate(
                  'components.landingContext.closeContext',
                  'Close current context'
                )}
              >
                <PanelRight size={16} />
              </button>
            </div>
          </header>
          <div className="landing-context-scroll">
            {workspace ? (
              <>
                <section className="landing-context-section">
                  <p className="landing-context-label">
                    {translate('components.landingContext.workspace', 'Workspace')}
                  </p>
                  <button
                    type="button"
                    className="landing-context-workspace"
                    onClick={() => activateAndRevealWorkspace(workspace.id)}
                  >
                    <span className="desktop-home-project-mark">
                      {workspace.repoName.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <strong>{workspace.name}</strong>
                      <small>{workspace.repoName}</small>
                    </span>
                    <ArrowRight />
                  </button>
                  <dl className="landing-context-details">
                    <div>
                      <dt>
                        <GitBranch />
                        {translate('components.landingContext.branch', 'Branch')}
                      </dt>
                      <dd>{workspace.branch}</dd>
                    </div>
                    <div>
                      <dt>
                        <FolderGit2 />
                        {translate('components.landingContext.location', 'Location')}
                      </dt>
                      <dd title={workspace.path}>{workspace.path}</dd>
                    </div>
                    <div>
                      <dt>
                        <Play />
                        {translate('components.landingContext.sessions', 'Sessions')}
                      </dt>
                      <dd>{workspace.sessionCount}</dd>
                    </div>
                    <div>
                      <dt>
                        <Bot />
                        {translate('components.landingContext.activity', 'Activity')}
                      </dt>
                      <dd>
                        {formatHomeRelativeTime(workspace.lastActivityAt, Date.now(), timeLabels)}
                      </dd>
                    </div>
                  </dl>
                </section>

                <section className="landing-context-section">
                  <p className="landing-context-label">
                    {translate('components.landingContext.openFiles', 'Open files')}
                  </p>
                  {model.currentFiles.length ? (
                    <div className="landing-context-files">
                      {model.currentFiles.map((file) => (
                        <div key={file.id}>
                          <FileCode2 />
                          <span title={file.relativePath}>{file.relativePath}</span>
                          {file.isDirty ? (
                            <i
                              aria-label={translate('components.landingContext.unsaved', 'Unsaved')}
                            />
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="landing-context-muted">
                      {translate(
                        'components.landingContext.noOpenFiles',
                        'No files are open in this workspace.'
                      )}
                    </p>
                  )}
                </section>

                <section className="landing-context-section">
                  <p className="landing-context-label">
                    {translate('components.landingContext.suggestedActions', 'Suggested actions')}
                  </p>
                  <button
                    type="button"
                    className="landing-context-primary"
                    onClick={() => activateAndRevealWorkspace(workspace.id)}
                  >
                    {translate('components.landingContext.continueWork', 'Continue previous work')}{' '}
                    <ArrowRight />
                  </button>
                  <button
                    type="button"
                    className="landing-context-secondary"
                    onClick={() =>
                      openModal('new-workspace-composer', {
                        initialRepoId: workspace.repoId,
                        telemetrySource: 'unknown'
                      })
                    }
                  >
                    {translate(
                      'components.landingContext.newWorkspaceFromProject',
                      'Create a workspace from this project'
                    )}
                  </button>
                </section>
              </>
            ) : (
              <div className="landing-context-empty">
                <span>
                  <FolderGit2 />
                </span>
                <h2>{translate('components.landingContext.noContext', 'No context selected')}</h2>
                <p>
                  {translate(
                    'components.landingContext.noContextDescription',
                    'Add a project and create a workspace to see branches, files, and recommended actions here.'
                  )}
                </p>
                <button type="button" onClick={() => openModal('add-repo')}>
                  {translate('components.desktopHome.addProject', 'Add project')}
                </button>
              </div>
            )}
          </div>
          <div
            className="absolute left-0 top-0 z-10 h-full w-1 cursor-col-resize transition-colors hover:bg-ring/20 active:bg-ring/30"
            onMouseDown={onResizeStart}
          />
        </>
      ) : null}
    </aside>
  )
}
