/* eslint-disable max-lines -- The desktop home keeps its orchestration and cards together for predictable layout state. */

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight, Code2, Sparkles, Workflow } from 'lucide-react'
import type { TuiAgent } from '../../../shared/tui-agent'
import {
  supportsTuiAgentLaunchPermission,
  type AgentLaunchPermissionMode
} from '../../../shared/tui-agent-permissions'
import { useAppStore } from '../store'
import { APP_DISPLAY_NAME, PRODUCT_LOGO_URL } from '@/product-brand'
import { cn } from '@/lib/utils'
import { getAgentCatalog } from '@/lib/agent-catalog'
import { useAgentDetectionTargetForWorktree } from '@/hooks/useAgentDetectionTarget'
import { useDetectedAgents } from '@/hooks/useDetectedAgents'
import { activateAndRevealWorkspace } from '@/lib/worktree-activation'
import { launchAgentInNewTab } from '@/lib/launch-agent-in-new-tab'
import { newAgentLaunchRequestId } from '@/lib/agent-launch-request-id'
import {
  filterQuickWorkspaceAgents,
  pickQuickWorkspaceAgent,
  resolveQuickWorkspaceAgentSelection
} from '@/lib/quick-workspace-agent-selection'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../shared/constants'
import { LOCAL_EXECUTION_HOST_ID } from '../../../shared/execution-host'
import { DesktopHomeComposerFooter } from './landing/DesktopHomeComposerFooter'
import { desktopHomeProjectIdentityFromSelection } from './landing/desktop-home-selection'
import { buildDesktopHomeModel, findDesktopHomeWorkspace } from './landing/desktop-home-model'
import { createSessionLaunchTracker } from './sessions/session-launch-tracker'
import mascotUrl from '../../../../resources/desktop-home-mascot-float.png'
import { isWebClientLocation } from '@/lib/web-client-location'
import { getDesktopHomeWebLaunchIssue } from './landing/desktop-home-web-launch'
import { translate } from '@/i18n/i18n'
import { useExecutionHostDisplayLabels } from '@/hooks/use-execution-host-display-labels'

type HomeScene = 'code' | 'automation'
const SCENES: { id: HomeScene; icon: typeof Code2; labelKey: string; placeholderKey: string }[] = [
  { id: 'code', icon: Code2, labelKey: 'sceneCode', placeholderKey: 'placeholderCode' },
  {
    id: 'automation',
    icon: Workflow,
    labelKey: 'sceneAutomation',
    placeholderKey: 'placeholderAutomation'
  }
]
const CAPABILITIES: Record<HomeScene, string[]> = {
  code: [
    'analyzeCode',
    'implementFeature',
    'fixIssue',
    'addTests',
    'refactorDocs',
    'generateCommit',
    'architecture'
  ],
  automation: ['scheduledBuild', 'summarizeChanges', 'batchTasks']
}

export default function Landing(): React.JSX.Element {
  useTranslation()
  const isWebClient = isWebClientLocation()
  const webLaunchIssueId = useId()
  const runtimeStatuses = useAppStore((state) => state.runtimeStatusByEnvironmentId)
  const repos = useAppStore((state) => state.repos)
  const worktreesByRepo = useAppStore((state) => state.worktreesByRepo)
  const tabsByWorktree = useAppStore((state) => state.tabsByWorktree)
  const unifiedTabsByWorktree = useAppStore((state) => state.unifiedTabsByWorktree)
  const openFiles = useAppStore((state) => state.openFiles)
  const projectGroups = useAppStore((state) => state.projectGroups)
  const folderWorkspaces = useAppStore((state) => state.folderWorkspaces)
  const projects = useAppStore((state) => state.projects)
  const projectHostSetups = useAppStore((state) => state.projectHostSetups)
  const activeWorkspaceKey = useAppStore((state) => state.activeWorkspaceKey)
  const activeWorktreeId = useAppStore((state) => state.activeWorktreeId)
  const activeRepoId = useAppStore((state) => state.activeRepoId)
  const activeWorkspaceExecutionHostId = useAppStore(
    (state) => state.activeWorkspaceExecutionHostId
  )
  const collapsedGroups = useAppStore((state) => state.collapsedGroups)
  const homeTaskDraft = useAppStore((state) => state.homeTaskDraft)
  const setHomeTaskDraft = useAppStore((state) => state.setHomeTaskDraft)
  const homeReturnScope = useAppStore((state) => state.homeReturnScope)
  const homeNewTaskMode = useAppStore((state) => state.homeNewTaskMode)
  const homeComposerFocusRequest = useAppStore((state) => state.homeComposerFocusRequest)
  const restoreHomeReturnScope = useAppStore((state) => state.restoreHomeReturnScope)
  const exitNewTaskHome = useAppStore((state) => state.exitNewTaskHome)
  const settings = useAppStore((state) => state.settings)
  const updateSettings = useAppStore((state) => state.updateSettings)
  const openSettingsPage = useAppStore((state) => state.openSettingsPage)
  const openSettingsTarget = useAppStore((state) => state.openSettingsTarget)
  const openModal = useAppStore((state) => state.openModal)
  const hostLabelById = useExecutionHostDisplayLabels()
  const model = useMemo(
    () =>
      buildDesktopHomeModel({
        repos,
        worktreesByRepo,
        tabsByWorktree,
        unifiedTabsByWorktree,
        openFiles,
        projectGroups,
        folderWorkspaces,
        projects,
        projectHostSetups,
        activeWorkspaceKey,
        activeWorktreeId,
        activeRepoId,
        activeWorkspaceExecutionHostId,
        collapsedGroups,
        hostLabelById
      }),
    [
      activeRepoId,
      activeWorkspaceExecutionHostId,
      activeWorkspaceKey,
      activeWorktreeId,
      collapsedGroups,
      folderWorkspaces,
      openFiles,
      projectGroups,
      projectHostSetups,
      projects,
      repos,
      tabsByWorktree,
      unifiedTabsByWorktree,
      worktreesByRepo,
      hostLabelById
    ]
  )
  // Keep the development surface as the default so the hero copy, composer
  // affordances, and first-time experience stay aligned.
  const [scene, setScene] = useState<HomeScene>('code')
  const [agentOverride, setAgentOverride] = useState<TuiAgent | null | undefined>(undefined)
  const [permissionMode, setPermissionMode] = useState<AgentLaunchPermissionMode>('default')
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const temporaryLaunchCleanup = useRef<(() => void) | null>(null)
  const [workspaceId, setWorkspaceId] = useState('')
  const capabilitiesRef = useRef<HTMLDivElement>(null)
  const [capabilityScroll, setCapabilityScroll] = useState({ atStart: true, atEnd: true })
  const activeScene = SCENES.find((entry) => entry.id === scene) ?? SCENES[0]
  const selectedProjectIdentity = desktopHomeProjectIdentityFromSelection(workspaceId)
  const selectedProject = selectedProjectIdentity
    ? (model.projects.find((project) => project.identityKey === selectedProjectIdentity) ?? null)
    : null
  const selectedWorkspace = selectedProject
    ? ([...selectedProject.workspaces].sort(
        (left, right) =>
          Number(right.isMainWorktree) - Number(left.isMainWorktree) ||
          right.lastActivityAt - left.lastActivityAt
      )[0] ?? null)
    : workspaceId
      ? findDesktopHomeWorkspace(model, workspaceId)
      : null
  const webLaunchIssue = isWebClient
    ? getDesktopHomeWebLaunchIssue(selectedWorkspace?.executionHostId, runtimeStatuses)
    : null
  const agentDetectionWorktreeId = selectedWorkspace
    ? selectedWorkspace.kind === 'folder'
      ? selectedWorkspace.workspaceKey
      : selectedWorkspace.id
    : FLOATING_TERMINAL_WORKTREE_ID
  const agentDetectionTarget = useAgentDetectionTargetForWorktree(agentDetectionWorktreeId)
  const { detectedIds: detectedAgentIds } = useDetectedAgents(agentDetectionTarget)
  const agentCatalog = getAgentCatalog()
  const availableAgents = filterQuickWorkspaceAgents(
    agentCatalog,
    detectedAgentIds,
    settings?.disabledTuiAgents
  )
  const preferredAgent = pickQuickWorkspaceAgent(
    settings?.defaultTuiAgent === 'blank' ? null : settings?.defaultTuiAgent,
    detectedAgentIds,
    settings?.disabledTuiAgents
  )
  const resolvedAgentSelection = resolveQuickWorkspaceAgentSelection({
    quickAgentOverride: agentOverride,
    preferredQuickAgent: preferredAgent,
    detectedAgentIds,
    disabledTuiAgents: settings?.disabledTuiAgents
  })
  if (resolvedAgentSelection.quickAgentOverride !== agentOverride) {
    // Match the new-session composer: a host switch or agent uninstall must
    // repair a stale manual choice before this dropdown can launch it.
    setAgentOverride(resolvedAgentSelection.quickAgentOverride)
  }
  const agent = resolvedAgentSelection.quickAgent
  const resolvedPermissionMode =
    agent && supportsTuiAgentLaunchPermission(agent) ? permissionMode : 'default'
  // A persisted selector value can briefly outlive the catalog row while a
  // host is hydrating. Keep that state from silently falling back to a
  // floating temporary session and losing the user's intended target.
  const targetSelectionPending = Boolean(workspaceId && !selectedWorkspace && !selectedProject)
  const syncCapabilityScroll = (): void => {
    const element = capabilitiesRef.current
    if (!element) {
      return
    }
    setCapabilityScroll({
      atStart: element.scrollLeft <= 2,
      atEnd: element.scrollLeft + element.clientWidth >= element.scrollWidth - 2
    })
  }
  const scrollCapabilities = (direction: -1 | 1): void => {
    capabilitiesRef.current?.scrollBy({ left: direction * 260, behavior: 'smooth' })
  }
  useEffect(() => {
    const frame = requestAnimationFrame(syncCapabilityScroll)
    return () => cancelAnimationFrame(frame)
  }, [scene])
  useEffect(() => {
    if (homeComposerFocusRequest <= 0) {
      return
    }
    const frame = requestAnimationFrame(() => {
      composerRef.current?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [homeComposerFocusRequest])
  useEffect(() => {
    // A new task starts unscoped by design. The user must opt into a project
    // or workspace from the inline context selector; the current workspace is
    // never silently reused as the task owner.
    if (homeNewTaskMode) {
      setWorkspaceId('')
    }
  }, [homeNewTaskMode])
  useEffect(() => () => temporaryLaunchCleanup.current?.(), [])
  const submit = (): void => {
    const prompt = homeTaskDraft.trim()
    if (!prompt || webLaunchIssue) {
      return
    }
    if (targetSelectionPending) {
      // The selected project/workspace is not available in the current
      // hydration snapshot yet. Waiting is safer than creating an unrelated
      // floating session with the same prompt.
      return
    }
    if (!selectedWorkspace) {
      if (selectedProject) {
        // A project with no materialized workspace still has a concrete source;
        // hand the prompt to the existing composer so it can create the first
        // worktree (or folder workspace) without losing the user's text.
        const projectGroup = selectedProject.projectGroupId
          ? projectGroups.find((group) => group.id === selectedProject.projectGroupId)
          : undefined
        openModal('new-workspace-composer', {
          ...(selectedProject.repoId ? { initialRepoId: selectedProject.repoId } : {}),
          ...(!selectedProject.repoId && projectGroup
            ? { initialProjectGroupId: projectGroup.id }
            : {}),
          initialPrompt: prompt,
          initialAgent: agent ?? undefined,
          initialAgentPermissionMode: resolvedPermissionMode,
          telemetrySource: 'unknown'
        })
        return
      }
      if (!agent) {
        return
      }
      temporaryLaunchCleanup.current?.()
      temporaryLaunchCleanup.current = null
      const tracker = createSessionLaunchTracker({
        ownerWorktreeId: FLOATING_TERMINAL_WORKTREE_ID,
        executionHostId: LOCAL_EXECUTION_HOST_ID,
        agent,
        onMatch: (item) => {
          const state = useAppStore.getState()
          state.openSessionsPage({ kind: 'all' })
          state.updateSessionsView({
            navigation: 'sessions',
            selectedSessionKey: item.key,
            query: '',
            scrollTop: 0
          })
          setHomeTaskDraft('')
          exitNewTaskHome()
        },
        onTimeout: () => {
          const state = useAppStore.getState()
          state.openSessionsPage({ kind: 'all' })
          state.updateSessionsView({
            navigation: 'sessions',
            selectedSessionKey: null,
            query: '',
            scrollTop: 0
          })
        }
      })
      temporaryLaunchCleanup.current = tracker.stop
      let launched: ReturnType<typeof launchAgentInNewTab> = null
      try {
        launched = launchAgentInNewTab({
          requestId: newAgentLaunchRequestId(),
          agent,
          worktreeId: FLOATING_TERMINAL_WORKTREE_ID,
          prompt,
          agentPermissionMode: resolvedPermissionMode,
          promptDelivery: 'auto-submit',
          launchSource: 'desktop_home'
        })
      } catch (error) {
        tracker.stop()
        temporaryLaunchCleanup.current = null
        console.error('Could not launch temporary session', error)
      }
      if (launched && tracker.markLaunched(launched.tabId)) {
        temporaryLaunchCleanup.current = null
      } else if (launched) {
        setHomeTaskDraft('')
        exitNewTaskHome()
      } else {
        tracker.stop()
        temporaryLaunchCleanup.current = null
      }
      return
    }
    if (!agent) {
      return
    }
    const activated = activateAndRevealWorkspace(
      selectedWorkspace.kind === 'folder' ? selectedWorkspace.workspaceKey : selectedWorkspace.id,
      {
        providesInitialSurface: true,
        executionHostId: selectedWorkspace.executionHostId
      }
    )
    if (!activated) {
      return
    }
    const launched = launchAgentInNewTab({
      requestId: newAgentLaunchRequestId(),
      agent,
      worktreeId:
        selectedWorkspace.kind === 'folder' ? selectedWorkspace.workspaceKey : selectedWorkspace.id,
      executionHostId: selectedWorkspace.executionHostId,
      prompt,
      agentPermissionMode: resolvedPermissionMode,
      promptDelivery: 'auto-submit',
      launchSource: 'desktop_home'
    })
    if (!launched) {
      return
    }
    setHomeTaskDraft('')
    exitNewTaskHome()
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
                    entry.id === 'code' ? 'Code development' : 'Everyday office'
                  )}
                </button>
              )
            })}
          </div>
          <div className="desktop-home-capabilities-shell">
            <div
              ref={capabilitiesRef}
              className="desktop-home-capabilities"
              aria-label={translate('components.desktopHome.capabilities', 'Common capabilities')}
              onScroll={syncCapabilityScroll}
            >
              {CAPABILITIES[scene].map((capabilityKey) => {
                const capability = translate(
                  `components.desktopHome.capability.${capabilityKey}`,
                  capabilityKey
                )
                return (
                  <button
                    type="button"
                    key={capabilityKey}
                    onClick={() => setHomeTaskDraft(capability)}
                  >
                    <Sparkles className="size-3.5" />
                    {capability}
                  </button>
                )
              })}
            </div>
            <div className="desktop-home-capability-arrows">
              <button
                type="button"
                onClick={() => scrollCapabilities(-1)}
                disabled={capabilityScroll.atStart}
                aria-label={translate(
                  'components.desktopHome.previousCapability',
                  'Previous capabilities'
                )}
              >
                <ChevronLeft />
              </button>
              <button
                type="button"
                onClick={() => scrollCapabilities(1)}
                disabled={capabilityScroll.atEnd}
                aria-label={translate('components.desktopHome.nextCapability', 'Next capabilities')}
              >
                <ChevronRight />
              </button>
            </div>
          </div>

          <section
            className="desktop-home-composer"
            aria-label={translate('components.desktopHome.newTask', 'New task')}
          >
            <textarea
              ref={composerRef}
              value={homeTaskDraft}
              onChange={(event) => setHomeTaskDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape' && homeNewTaskMode && homeReturnScope) {
                  event.preventDefault()
                  restoreHomeReturnScope()
                  return
                }
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                  event.preventDefault()
                  submit()
                }
              }}
              placeholder={translate(
                `components.desktopHome.${activeScene.placeholderKey}`,
                activeScene.id === 'code'
                  ? 'Describe the development task to complete…'
                  : 'Describe the repetitive work to automate…'
              )}
              aria-label={translate('components.desktopHome.taskDescription', 'Task description')}
              aria-describedby={webLaunchIssue ? webLaunchIssueId : undefined}
            />
            <DesktopHomeComposerFooter
              allowTemporarySession={!isWebClient}
              model={model}
              selectedWorkspaceId={workspaceId}
              onWorkspaceChange={setWorkspaceId}
              agent={agent}
              agents={availableAgents}
              onAgentChange={setAgentOverride}
              defaultAgent={settings?.defaultTuiAgent ?? null}
              onSetDefaultAgent={(nextAgent) => {
                void updateSettings({ defaultTuiAgent: nextAgent })
              }}
              onOpenAgentSettings={() => {
                openSettingsTarget({ pane: 'agents', repoId: null })
                openSettingsPage()
              }}
              permissionMode={resolvedPermissionMode}
              onPermissionChange={setPermissionMode}
              hasDraft={
                Boolean(homeTaskDraft.trim()) &&
                !targetSelectionPending &&
                !webLaunchIssue &&
                (agent !== null || Boolean(selectedProject && !selectedWorkspace))
              }
              onSubmit={submit}
            />
          </section>
          {webLaunchIssue ? (
            <p
              id={webLaunchIssueId}
              role="status"
              className="mt-3 px-5 text-xs text-muted-foreground"
            >
              {webLaunchIssue}
            </p>
          ) : null}
        </div>
      </div>
    </main>
  )
}
