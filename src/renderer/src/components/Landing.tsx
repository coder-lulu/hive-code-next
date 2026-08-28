/* eslint-disable max-lines -- The desktop home keeps its orchestration and cards together for predictable layout state. */

import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
  type HomeRelativeTimeLabels,
  type DesktopHomeWorkspace
} from './landing/desktop-home-model'
import mascotUrl from '../../../../resources/desktop-home-mascot-float.png'
import { translate } from '@/i18n/i18n'

type HomeScene = 'code' | 'automation' | 'collaboration'
const SCENES: { id: HomeScene; icon: typeof Braces; labelKey: string; placeholderKey: string }[] = [
  { id: 'code', icon: Braces, labelKey: 'sceneCode', placeholderKey: 'placeholderCode' },
  {
    id: 'automation',
    icon: WandSparkles,
    labelKey: 'sceneAutomation',
    placeholderKey: 'placeholderAutomation'
  },
  {
    id: 'collaboration',
    icon: UsersRound,
    labelKey: 'sceneCollaboration',
    placeholderKey: 'placeholderCollaboration'
  }
]
const CAPABILITIES: Record<HomeScene, string[]> = {
  code: ['analyzeCode', 'implementFeature', 'fixIssue', 'addTests'],
  automation: ['scheduledBuild', 'summarizeChanges', 'batchTasks'],
  collaboration: ['breakDownRequirements', 'parallelReview', 'planDelivery']
}

function WorkspaceRow({
  workspace,
  timeLabels
}: {
  workspace: DesktopHomeWorkspace
  timeLabels: HomeRelativeTimeLabels
}): React.JSX.Element {
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
          {workspace.branch === 'unnamed'
            ? translate('components.desktopHome.unnamedBranch', 'Unnamed branch')
            : workspace.branch}
          <span aria-hidden>·</span>
          {translate(`components.desktopHome.host.${workspace.hostLabel}`, workspace.hostLabel)}
        </span>
      </span>
      <span className="shrink-0 text-[11px] text-muted-foreground">
        {formatHomeRelativeTime(workspace.lastActivityAt, Date.now(), timeLabels)}
      </span>
      <ArrowRight className="size-3.5 -translate-x-1 text-muted-foreground opacity-0 transition group-hover:translate-x-0 group-hover:opacity-100" />
    </button>
  )
}

export default function Landing(): React.JSX.Element {
  useTranslation()
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
  const homeTimeLabels = {
    unused: translate('components.desktopHome.time.unused', 'Not used yet'),
    justNow: translate('components.desktopHome.time.justNow', 'Just now'),
    minutesAgo: (value: number) =>
      translate('components.desktopHome.time.minutesAgo', '{{value}} min ago', { value }),
    hoursAgo: (value: number) =>
      translate('components.desktopHome.time.hoursAgo', '{{value}} hr ago', { value }),
    daysAgo: (value: number) =>
      translate('components.desktopHome.time.daysAgo', '{{value}} days ago', { value })
  }

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
                <h1 id="desktop-home-title">
                  {translate(
                    'components.desktopHome.heroTitle',
                    "{{app}} — start today's development",
                    {
                      app: APP_DISPLAY_NAME
                    }
                  )}
                </h1>
                <p>
                  {translate(
                    'components.desktopHome.heroDescription',
                    'AI-powered development assistance to help you build better software, faster.'
                  )}
                </p>
              </div>
            </div>
            <div className="desktop-home-mascot-wrap">
              <span className="desktop-home-help-bubble">
                {translate('components.desktopHome.helpBubble', 'Here whenever you need help')}
              </span>
              <img
                className="desktop-home-mascot"
                src={mascotUrl}
                alt={translate('components.desktopHome.mascotAlt', '{{app}} assistant', {
                  app: APP_DISPLAY_NAME
                })}
              />
            </div>
          </section>

          {preflightIssues.length > 0 ? (
            <LandingPreflightBanner issues={preflightIssues} repos={repos} />
          ) : null}

          <div
            className="desktop-home-scene-tabs"
            role="tablist"
            aria-label={translate('components.desktopHome.workModes', 'Work modes')}
          >
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
                  {translate(
                    `components.desktopHome.${entry.labelKey}`,
                    entry.id === 'code'
                      ? 'Cloud work'
                      : entry.id === 'automation'
                        ? 'Automation'
                        : 'Agent collaboration'
                  )}
                </button>
              )
            })}
          </div>
          <div
            className="desktop-home-capabilities"
            aria-label={translate('components.desktopHome.capabilities', 'Common capabilities')}
          >
            {CAPABILITIES[scene].map((capabilityKey) => {
              const capability = translate(
                `components.desktopHome.capability.${capabilityKey}`,
                capabilityKey
              )
              return (
                <button type="button" key={capabilityKey} onClick={() => setDraft(capability)}>
                  <Sparkles className="size-3" />
                  {capability}
                </button>
              )
            })}
          </div>

          <section
            className="desktop-home-composer"
            aria-label={translate('components.desktopHome.newTask', 'New task')}
          >
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                  event.preventDefault()
                  submit()
                }
              }}
              placeholder={translate(
                `components.desktopHome.${activeScene.placeholderKey}`,
                activeScene.id === 'code'
                  ? 'Describe the development task to complete…'
                  : activeScene.id === 'automation'
                    ? 'Describe the repetitive work to automate…'
                    : 'Describe the task that needs multiple agents…'
              )}
              aria-label={translate('components.desktopHome.taskDescription', 'Task description')}
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

          <section
            className="desktop-home-grid"
            aria-label={translate('components.desktopHome.workOverview', 'Work overview')}
          >
            <article className="desktop-home-card desktop-home-card-wide">
              <header>
                <div>
                  <span className="desktop-home-card-icon">
                    <Clock3 />
                  </span>
                  <h2>
                    {translate('components.desktopHome.recentWorkspaces', 'Recent workspaces')}
                  </h2>
                </div>
                <button type="button" onClick={() => openModal('add-repo')}>
                  {translate('components.desktopHome.manageProjects', 'Manage projects')}
                </button>
              </header>
              <div className="desktop-home-card-body">
                {model.recentWorkspaces.length ? (
                  model.recentWorkspaces.map((workspace) => (
                    <WorkspaceRow
                      key={workspace.id}
                      workspace={workspace}
                      timeLabels={homeTimeLabels}
                    />
                  ))
                ) : (
                  <div className="desktop-home-empty">
                    <FolderGit2 />
                    <p>{translate('components.desktopHome.noProjects', 'No projects yet')}</p>
                    <span>
                      {translate(
                        'components.desktopHome.noProjectsDescription',
                        'Add a code repository to see workspaces here.'
                      )}
                    </span>
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
                  <h2>{translate('components.desktopHome.quickStart', 'Quick start')}</h2>
                </div>
              </header>
              <div className="desktop-home-action-list">
                <button type="button" onClick={() => openModal('add-repo')}>
                  <FolderPlus />
                  <span>
                    <strong>{translate('components.desktopHome.addProject', 'Add project')}</strong>
                    <small>
                      {translate(
                        'components.desktopHome.addProjectDescription',
                        'Connect a local or remote repository'
                      )}
                    </small>
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
                    <strong>
                      {translate('components.desktopHome.newWorkspace', 'New workspace')}
                    </strong>
                    <small>
                      {translate(
                        'components.desktopHome.newWorkspaceDescription',
                        'Isolate branches and agent sessions'
                      )}
                    </small>
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
                  <h2>{translate('components.desktopHome.continueWork', 'Continue working')}</h2>
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
                        <dt>{translate('components.desktopHome.sessions', 'Sessions')}</dt>
                        <dd>{model.currentWorkspace.sessionCount}</dd>
                      </div>
                      <div>
                        <dt>
                          {translate('components.desktopHome.recentActivity', 'Recent activity')}
                        </dt>
                        <dd>
                          {formatHomeRelativeTime(
                            model.currentWorkspace.lastActivityAt,
                            Date.now(),
                            homeTimeLabels
                          )}
                        </dd>
                      </div>
                    </dl>
                    <button
                      type="button"
                      className="desktop-home-secondary-button"
                      onClick={() => activateAndRevealWorkspace(model.currentWorkspace!.id)}
                    >
                      {translate('components.desktopHome.enterWorkspace', 'Open workspace')}{' '}
                      <ArrowRight />
                    </button>
                  </>
                ) : (
                  <div className="desktop-home-empty">
                    <Layers3 />
                    <p>{translate('components.desktopHome.noContinue', 'Nothing to continue')}</p>
                    <span>
                      {translate(
                        'components.desktopHome.noContinueDescription',
                        'Create a workspace to return here quickly.'
                      )}
                    </span>
                  </div>
                )}
              </div>
            </article>
          </section>
          <div
            className="desktop-home-meta"
            aria-label={translate('components.desktopHome.projectStatsLabel', 'Project statistics')}
          >
            {translate(
              'components.desktopHome.projectStats',
              '{{projects}} projects · {{workspaces}} workspaces',
              {
                projects: model.projectCount,
                workspaces: model.workspaceCount
              }
            )}
          </div>
        </div>
      </div>
    </main>
  )
}
