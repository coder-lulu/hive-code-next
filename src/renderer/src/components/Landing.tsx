import { useMemo, useState } from 'react'
import {
  ArrowRight,
  Braces,
  Clock3,
  FolderGit2,
  FolderPlus,
  GitBranch,
  GitBranchPlus,
  Layers3,
  Play,
  Sparkles,
  UsersRound,
  WandSparkles
} from 'lucide-react'
import type { TuiAgent } from '../../../shared/tui-agent'
import { useAppStore } from '../store'
import { APP_DISPLAY_NAME, PRODUCT_LOGO_URL } from '@/product-brand'
import { cn } from '@/lib/utils'
import { getAgentCatalog } from '@/lib/agent-catalog'
import { activateAndRevealWorkspace } from '@/lib/worktree-activation'
import { launchAgentInNewTab } from '@/lib/launch-agent-in-new-tab'
import { useLandingPreflightRuntime } from './landing-preflight-runtime'
import { LandingPreflightBanner } from './landing/LandingPreflightBanner'
import { DesktopHomeComposerFooter } from './landing/DesktopHomeComposerFooter'
import {
  buildDesktopHomeModel,
  formatHomeRelativeTime,
  type DesktopHomeWorkspace
} from './landing/desktop-home-model'
import mascotUrl from '../../../../resources/desktop-home-mascot-float.png'

type HomeScene = 'code' | 'automation' | 'collaboration'
const SCENES: { id: HomeScene; label: string; icon: typeof Braces; placeholder: string }[] = [
  { id: 'code', label: '云端工作', icon: Braces, placeholder: '描述要完成的开发任务…' },
  {
    id: 'automation',
    label: '自动化',
    icon: WandSparkles,
    placeholder: '描述要自动执行的重复工作…'
  },
  {
    id: 'collaboration',
    label: 'Agent 协作',
    icon: UsersRound,
    placeholder: '描述需要多角色协作的任务…'
  }
]
const CAPABILITIES: Record<HomeScene, string[]> = {
  code: ['分析代码库', '实现新功能', '修复问题', '补充测试'],
  automation: ['定时检查构建', '整理变更摘要', '批量处理任务'],
  collaboration: ['拆解复杂需求', '并行审查代码', '制定交付方案']
}

function WorkspaceRow({ workspace }: { workspace: DesktopHomeWorkspace }): React.JSX.Element {
  return (
    <button
      type="button"
      className="desktop-home-workspace-row group"
      onClick={() => activateAndRevealWorkspace(workspace.id)}
    >
      <span
        className="desktop-home-project-mark"
        style={{ backgroundColor: workspace.badgeColor ?? '#2F6BFF' }}
      >
        {workspace.repoName.slice(0, 1).toUpperCase()}
      </span>
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate text-[13px] font-semibold text-foreground">
          {workspace.name}
        </span>
        <span className="mt-0.5 flex items-center gap-1.5 truncate text-[11px] text-muted-foreground">
          <GitBranch className="size-3" />
          {workspace.branch}
          <span aria-hidden>·</span>
          {workspace.hostLabel}
        </span>
      </span>
      <span className="shrink-0 text-[11px] text-muted-foreground">
        {formatHomeRelativeTime(workspace.lastActivityAt)}
      </span>
      <ArrowRight className="size-3.5 -translate-x-1 text-muted-foreground opacity-0 transition group-hover:translate-x-0 group-hover:opacity-100" />
    </button>
  )
}

export default function Landing(): React.JSX.Element {
  const repos = useAppStore((state) => state.repos)
  const worktreesByRepo = useAppStore((state) => state.worktreesByRepo)
  const tabsByWorktree = useAppStore((state) => state.tabsByWorktree)
  const openFiles = useAppStore((state) => state.openFiles)
  const settings = useAppStore((state) => state.settings)
  const openModal = useAppStore((state) => state.openModal)
  const { preflightIssues } = useLandingPreflightRuntime()
  const model = useMemo(
    () => buildDesktopHomeModel({ repos, worktreesByRepo, tabsByWorktree, openFiles }),
    [openFiles, repos, tabsByWorktree, worktreesByRepo]
  )
  const enabledAgents = useMemo(() => {
    const disabled = new Set(settings?.disabledTuiAgents ?? [])
    return getAgentCatalog()
      .filter((entry) => !disabled.has(entry.id))
      .slice(0, 8)
  }, [settings?.disabledTuiAgents])
  const preferredAgent = settings?.defaultTuiAgent
  const initialAgent: TuiAgent =
    preferredAgent &&
    preferredAgent !== 'blank' &&
    enabledAgents.some((entry) => entry.id === preferredAgent)
      ? preferredAgent
      : (enabledAgents[0]?.id ?? 'codex')
  const [scene, setScene] = useState<HomeScene>('code')
  const [draft, setDraft] = useState('')
  const [agent, setAgent] = useState<TuiAgent>(initialAgent)
  const [permissionMode, setPermissionMode] = useState('default')
  const [workspaceId, setWorkspaceId] = useState(model.currentWorkspace?.id ?? '')
  const activeScene = SCENES.find((entry) => entry.id === scene) ?? SCENES[0]
  const selectedWorkspace =
    model.recentWorkspaces.find((workspace) => workspace.id === workspaceId) ??
    model.currentWorkspace

  const submit = (): void => {
    const prompt = draft.trim()
    if (!prompt) {
      return
    }
    if (!selectedWorkspace) {
      openModal('new-workspace-composer', { initialPrompt: prompt, telemetrySource: 'unknown' })
      return
    }
    const activated = activateAndRevealWorkspace(selectedWorkspace.id, {
      providesInitialSurface: true
    })
    if (!activated) {
      return
    }
    launchAgentInNewTab({
      agent,
      worktreeId: selectedWorkspace.id,
      prompt,
      promptDelivery: 'auto-submit'
    })
  }

  return (
    <main className="desktop-home" data-testid="desktop-home">
      <div className="desktop-home-scroll">
        <div className="desktop-home-canvas">
          <section className="desktop-home-hero" aria-labelledby="desktop-home-title">
            <div className="desktop-home-hero-brand">
              <img src={PRODUCT_LOGO_URL} alt="" aria-hidden />
              <div className="min-w-0 flex-1">
                <h1 id="desktop-home-title">{APP_DISPLAY_NAME}，开始今天的开发工作</h1>
                <p>AI 驱动的开发助手，帮你更快地构建更好的软件。</p>
              </div>
            </div>
            <div className="desktop-home-mascot-wrap">
              <span className="desktop-home-help-bubble">随时为你提供帮助</span>
              <img className="desktop-home-mascot" src={mascotUrl} alt={`${APP_DISPLAY_NAME} 助手`} />
            </div>
          </section>

          {preflightIssues.length > 0 ? (
            <LandingPreflightBanner issues={preflightIssues} repos={repos} />
          ) : null}

          <div className="desktop-home-scene-tabs" role="tablist" aria-label="工作模式">
            {SCENES.map((entry) => {
              const Icon = entry.icon
              return (
                <button
                  key={entry.id}
                  type="button"
                  role="tab"
                  aria-selected={scene === entry.id}
                  className={cn('desktop-home-scene-tab', scene === entry.id && 'is-active')}
                  onClick={() => setScene(entry.id)}
                >
                  <Icon className="size-3.5" />
                  {entry.label}
                </button>
              )
            })}
          </div>
          <div className="desktop-home-capabilities" aria-label="常用能力">
            {CAPABILITIES[scene].map((capability) => (
              <button type="button" key={capability} onClick={() => setDraft(capability)}>
                <Sparkles className="size-3" />
                {capability}
              </button>
            ))}
          </div>

          <section className="desktop-home-composer" aria-label="新任务">
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                  event.preventDefault()
                  submit()
                }
              }}
              placeholder={activeScene.placeholder}
              aria-label="任务描述"
            />
            <DesktopHomeComposerFooter
              model={model}
              selectedWorkspaceId={selectedWorkspace?.id ?? ''}
              onWorkspaceChange={setWorkspaceId}
              agent={agent}
              enabledAgents={enabledAgents}
              onAgentChange={setAgent}
              permissionMode={permissionMode}
              onPermissionChange={setPermissionMode}
              hasDraft={Boolean(draft.trim())}
              onSubmit={submit}
            />
          </section>

          <section className="desktop-home-grid" aria-label="工作概览">
            <article className="desktop-home-card desktop-home-card-wide">
              <header>
                <div>
                  <span className="desktop-home-card-icon">
                    <Clock3 />
                  </span>
                  <h2>最近工作区</h2>
                </div>
                <button type="button" onClick={() => openModal('add-repo')}>
                  管理项目
                </button>
              </header>
              <div className="desktop-home-card-body">
                {model.recentWorkspaces.length ? (
                  model.recentWorkspaces.map((workspace) => (
                    <WorkspaceRow key={workspace.id} workspace={workspace} />
                  ))
                ) : (
                  <div className="desktop-home-empty">
                    <FolderGit2 />
                    <p>还没有项目</p>
                    <span>添加代码仓库后，工作区会显示在这里。</span>
                  </div>
                )}
              </div>
            </article>
            <article className="desktop-home-card">
              <header>
                <div>
                  <span className="desktop-home-card-icon">
                    <Play />
                  </span>
                  <h2>快速开始</h2>
                </div>
              </header>
              <div className="desktop-home-action-list">
                <button type="button" onClick={() => openModal('add-repo')}>
                  <FolderPlus />
                  <span>
                    <strong>添加项目</strong>
                    <small>连接本地或远程仓库</small>
                  </span>
                  <ArrowRight />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    openModal('new-workspace-composer', { telemetrySource: 'unknown' })
                  }
                >
                  <GitBranchPlus />
                  <span>
                    <strong>新建工作区</strong>
                    <small>隔离分支与 Agent 会话</small>
                  </span>
                  <ArrowRight />
                </button>
              </div>
            </article>
            <article className="desktop-home-card">
              <header>
                <div>
                  <span className="desktop-home-card-icon">
                    <Layers3 />
                  </span>
                  <h2>继续工作</h2>
                </div>
              </header>
              <div className="desktop-home-continue">
                {model.currentWorkspace ? (
                  <>
                    <div className="desktop-home-continue-project">
                      <span className="desktop-home-project-mark">
                        {model.currentWorkspace.repoName.slice(0, 1).toUpperCase()}
                      </span>
                      <div className="min-w-0">
                        <strong>{model.currentWorkspace.name}</strong>
                        <span>
                          {model.currentWorkspace.repoName} · {model.currentWorkspace.branch}
                        </span>
                      </div>
                    </div>
                    <dl>
                      <div>
                        <dt>会话</dt>
                        <dd>{model.currentWorkspace.sessionCount}</dd>
                      </div>
                      <div>
                        <dt>最近活动</dt>
                        <dd>{formatHomeRelativeTime(model.currentWorkspace.lastActivityAt)}</dd>
                      </div>
                    </dl>
                    <button
                      type="button"
                      className="desktop-home-secondary-button"
                      onClick={() => activateAndRevealWorkspace(model.currentWorkspace!.id)}
                    >
                      进入工作区 <ArrowRight />
                    </button>
                  </>
                ) : (
                  <div className="desktop-home-empty">
                    <Layers3 />
                    <p>暂无可继续的工作</p>
                    <span>创建工作区后可从这里快速返回。</span>
                  </div>
                )}
              </div>
            </article>
          </section>
          <div className="desktop-home-meta" aria-label="项目统计">
            {model.projectCount} 个项目 · {model.workspaceCount} 个工作区
          </div>
        </div>
      </div>
    </main>
  )
}
