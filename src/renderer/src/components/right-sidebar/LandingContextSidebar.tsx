import { useMemo } from 'react'
import { ArrowRight, Bot, FileCode2, FolderGit2, GitBranch, PanelRight, Play } from 'lucide-react'
import { useAppStore } from '@/store'
import { useSidebarResize } from '@/hooks/useSidebarResize'
import { activateAndRevealWorkspace } from '@/lib/worktree-activation'
import {
  buildDesktopHomeModel,
  formatHomeRelativeTime
} from '@/components/landing/desktop-home-model'
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

  return (
    <aside
      ref={containerRef}
      className={`landing-context-sidebar${rightSidebarOpen ? ' is-open' : ''}`}
      aria-label="当前上下文"
    >
      {rightSidebarOpen ? (
        <>
          <header className="landing-context-header right-sidebar-header-inset right-sidebar-header-drag">
            <span>当前上下文</span>
            <div className="flex shrink-0 items-center gap-1">
              {showSettingsHelpControls ? <SidebarSettingsHelpMenu /> : null}
              <button
                type="button"
                className="sidebar-toggle"
                onClick={toggleRightSidebar}
                aria-label="关闭当前上下文"
              >
                <PanelRight size={16} />
              </button>
            </div>
          </header>
          <div className="landing-context-scroll">
            {workspace ? (
              <>
                <section className="landing-context-section">
                  <p className="landing-context-label">工作区</p>
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
                        分支
                      </dt>
                      <dd>{workspace.branch}</dd>
                    </div>
                    <div>
                      <dt>
                        <FolderGit2 />
                        位置
                      </dt>
                      <dd title={workspace.path}>{workspace.path}</dd>
                    </div>
                    <div>
                      <dt>
                        <Play />
                        会话
                      </dt>
                      <dd>{workspace.sessionCount}</dd>
                    </div>
                    <div>
                      <dt>
                        <Bot />
                        活动
                      </dt>
                      <dd>{formatHomeRelativeTime(workspace.lastActivityAt)}</dd>
                    </div>
                  </dl>
                </section>

                <section className="landing-context-section">
                  <p className="landing-context-label">当前打开的文件</p>
                  {model.currentFiles.length ? (
                    <div className="landing-context-files">
                      {model.currentFiles.map((file) => (
                        <div key={file.id}>
                          <FileCode2 />
                          <span title={file.relativePath}>{file.relativePath}</span>
                          {file.isDirty ? <i aria-label="未保存" /> : null}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="landing-context-muted">该工作区尚未打开文件。</p>
                  )}
                </section>

                <section className="landing-context-section">
                  <p className="landing-context-label">建议操作</p>
                  <button
                    type="button"
                    className="landing-context-primary"
                    onClick={() => activateAndRevealWorkspace(workspace.id)}
                  >
                    继续上次工作 <ArrowRight />
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
                    基于此项目新建工作区
                  </button>
                </section>
              </>
            ) : (
              <div className="landing-context-empty">
                <span>
                  <FolderGit2 />
                </span>
                <h2>尚未选择上下文</h2>
                <p>添加项目并创建工作区后，这里会显示分支、文件与推荐操作。</p>
                <button type="button" onClick={() => openModal('add-repo')}>
                  添加项目
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
