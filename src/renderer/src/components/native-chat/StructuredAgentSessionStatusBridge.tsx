import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { agentProviderSessionsEqual } from '../../../../shared/agent-session-resume'
import type { AgentSessionStatusSummary } from '../../../../shared/agent-session-wire'
import {
  agentChildWorkProjectionCandidateFromBackgroundTask,
  projectAgentChildWorkLegacySubagents
} from '../../../../shared/agent-status-child-work-projection'
import {
  continueMainAgentStatus,
  isAgentStatusHeldOpenByChildWork,
  mainAgentTurnInterrupted
} from '../../../../shared/agent-lead-status-fold'
import { mainAgentStatusEqual, agentSubagentsEqual } from '../../../../shared/agent-status-types'
import { structuredAgentSessionPaneKey } from '../../../../shared/structured-agent-session-projection'
import { structuredAgentSessionAgentStatus } from '../../../../shared/structured-agent-session-agent-status'
import {
  structuredAgentSessionDatedMainAgent,
  structuredAgentSessionRowStateStartedAt
} from '../../../../shared/structured-agent-session-status-started-at'
import type { Tab } from '../../../../shared/tab-types'
import { isAgentSessionHandleProvider } from '../../../../shared/agent-session-provider-handle'
import { useAppStore } from '@/store'
import type { RuntimeClientTarget } from '@/runtime/runtime-rpc-client'
import { getStructuredAgentSessionStatusFeed } from '@/runtime/structured-agent-session-status-feed'
import { resolveStructuredSessionRuntimeTarget } from './structured-session-runtime-target'
import { getWorktreeIdFromHostIdentity } from '../../../../shared/worktree/host-qualified-identity'

type StructuredTab = Tab & { contentType: 'agent-session' }
type OwnedStructuredTab = { tab: StructuredTab; bucket: string; uniquePaneKey: boolean }

function isStructuredTab(tab: Tab): tab is StructuredTab {
  return tab.contentType === 'agent-session' && isAgentSessionHandleProvider(tab.agentSessionAgent)
}

const structuredTabsByUnifiedTabsSnapshot = new WeakMap<
  Record<string, Tab[]>,
  { tabs: readonly StructuredTab[]; owners: readonly OwnedStructuredTab[] }
>()

/** Project structured-session tabs once per immutable tab-map snapshot. */
export function getStructuredAgentSessionTabs(
  unifiedTabsByWorktree: Record<string, Tab[]>
): readonly StructuredTab[] {
  return getStructuredTabOwners(unifiedTabsByWorktree).tabs
}

function getStructuredTabOwners(unifiedTabsByWorktree: Record<string, Tab[]>) {
  const cached = structuredTabsByUnifiedTabsSnapshot.get(unifiedTabsByWorktree)
  if (cached) {
    return cached
  }

  const tabs: StructuredTab[] = []
  const owners: OwnedStructuredTab[] = []
  const counts = new Map<string, number>()
  for (const [bucket, worktreeTabs] of Object.entries(unifiedTabsByWorktree)) {
    for (const tab of worktreeTabs) {
      if (isStructuredTab(tab)) {
        tabs.push(tab)
        owners.push({ tab, bucket, uniquePaneKey: false })
        const key = structuredAgentSessionPaneKey(tab.id, tab.entityId)
        counts.set(key, (counts.get(key) ?? 0) + 1)
      }
    }
  }
  for (const entry of owners) {
    entry.uniquePaneKey =
      counts.get(structuredAgentSessionPaneKey(entry.tab.id, entry.tab.entityId)) === 1
  }
  const result = { tabs, owners }
  structuredTabsByUnifiedTabsSnapshot.set(unifiedTabsByWorktree, result)
  return result
}

const subscribeEmpty = (): (() => void) => () => {}

/** The host's projected status for one session, live while the caller is mounted. */
export function useStructuredAgentSessionStatusSummary(
  sessionId: string,
  target: RuntimeClientTarget | null
): { summary: AgentSessionStatusSummary | null; observation: 'live' | 'unverifiable' } {
  const feed = useMemo(
    () => (target ? getStructuredAgentSessionStatusFeed(target) : null),
    [target]
  )
  useEffect(() => feed?.activate(), [feed])
  const summary = useSyncExternalStore(
    feed?.subscribe ?? subscribeEmpty,
    () => feed?.getSnapshot().get(sessionId) ?? null,
    () => null
  )
  const observation = useSyncExternalStore(
    feed?.subscribe ?? subscribeEmpty,
    () => feed?.getSessionObservation(sessionId) ?? 'unverifiable',
    () => 'unverifiable' as const
  )
  return { summary, observation }
}

/** The host's child state, projected to stable primitives so journal updates do not re-render chat. */
export function useStructuredAgentSessionHostExecution(
  sessionId: string,
  target: RuntimeClientTarget
): {
  phase: NonNullable<AgentSessionStatusSummary['hostExecutionPhase']> | null
  childKey: string | number | null
} {
  const feed = useMemo(() => getStructuredAgentSessionStatusFeed(target), [target])
  useEffect(() => feed.activate(), [feed])
  const phase = useSyncExternalStore(
    feed.subscribe,
    () => feed.getSnapshot().get(sessionId)?.hostExecutionPhase ?? null,
    () => null
  )
  const childKey = useSyncExternalStore(
    feed.subscribe,
    () => {
      const child = feed.getSnapshot().get(sessionId)?.hostExecutionChild
      return child?.generation ?? child?.fence ?? null
    },
    () => null
  )
  return { phase, childKey }
}

function projectStatus(
  tab: StructuredTab,
  summary: AgentSessionStatusSummary | null,
  observation: 'live' | 'unverifiable'
): void {
  const paneKey = structuredAgentSessionPaneKey(tab.id, tab.entityId)
  const store = useAppStore.getState()
  // No persisted turn yet (or nothing known): the row shows no agent status at all.
  if (!summary?.status) {
    if (store.agentStatusByPaneKey?.[paneKey]) {
      store.removeAgentStatus(paneKey)
    }
    return
  }
  // Sidebar children are the agent-kind tasks, projected by the same code every
  // child-work reader uses; a backgrounded shell never counts as a subagent.
  const subagents = summary.backgroundTasks
    ? projectAgentChildWorkLegacySubagents(
        summary.backgroundTasks.map(agentChildWorkProjectionCandidateFromBackgroundTask)
      )
    : undefined
  // Shared with `worktree ps`, so the CLI and this row cannot disagree about one session.
  const agentStatus = structuredAgentSessionAgentStatus({
    status: summary.status,
    backgroundTasks: summary.backgroundTasks,
    turnOutcome: summary.turnOutcome
  })
  const current = store.agentStatusByPaneKey?.[paneKey]
  // Same continuity rule as the host ingest, on the main agent's own clock.
  const mainAgent = continueMainAgentStatus(
    current?.mainAgent,
    structuredAgentSessionDatedMainAgent(agentStatus.mainAgent, summary),
    summary.updatedAt
  )
  const desired = {
    state: agentStatus.state,
    ...(agentStatus.workingMode ? { workingMode: agentStatus.workingMode } : {}),
    mainAgent,
    // Derived from `mainAgent`, so the equality below needs no second check of it.
    interrupted: mainAgentTurnInterrupted(mainAgent),
    prompt: summary.latestPrompt,
    agentType: tab.agentSessionAgent,
    // The host projects these from the journal so the row reads like a hook-reported one:
    // the turn's running or latest tool while it is live, the agent's last words once it settles.
    ...(summary.model ? { model: summary.model } : {}),
    ...(summary.toolName ? { toolName: summary.toolName } : {}),
    ...(summary.toolInput ? { toolInput: summary.toolInput } : {}),
    ...(summary.lastAssistantMessage ? { lastAssistantMessage: summary.lastAssistantMessage } : {}),
    ...(subagents ? { subagents, subagentObservation: observation } : {}),
    sessionBoundary: false
  } as const
  if (
    current?.state === desired.state &&
    current.workingMode === desired.workingMode &&
    mainAgentStatusEqual(current.mainAgent, desired.mainAgent) &&
    current.prompt === desired.prompt &&
    current.agentType === desired.agentType &&
    // A row keeps the last model it was told about, so only a reported one can differ.
    (summary.model === undefined || current.model === summary.model) &&
    current.toolName === summary.toolName &&
    current.toolInput === summary.toolInput &&
    current.lastAssistantMessage === summary.lastAssistantMessage &&
    agentSubagentsEqual(current.subagents, subagents) &&
    current.subagentObservation === desired.subagentObservation &&
    current.sessionBoundary === desired.sessionBoundary &&
    current.updatedAt === summary.updatedAt &&
    current.terminalTitle === tab.label &&
    current.tabId === tab.id &&
    current.worktreeId === tab.worktreeId &&
    current.terminalResumeEligible === false &&
    current.structuredHostOwned === summary.hostExecutionOwned &&
    agentProviderSessionsEqual(
      tab.agentSessionAgent,
      current.providerSession,
      summary.providerSession
    )
  ) {
    return
  }
  store.setAgentStatus(
    paneKey,
    desired,
    tab.label,
    {
      updatedAt: summary.updatedAt,
      // This ordered host feed can correct a legacy publication clock after upgrade.
      allowOlderTimestamp: true,
      // Same continuity key as the host ingest: monitoring and working are distinct published
      // states, so the timer beside the label must restart when the label changes.
      stateStartedAt:
        structuredAgentSessionRowStateStartedAt(desired, summary) ??
        (desired.state !== 'done' &&
        current?.state === desired.state &&
        current.workingMode === desired.workingMode
          ? current.stateStartedAt
          : summary.updatedAt),
      // Same rule as the host ingest: the journal clock stopped when the lead's turn did, so a
      // row held open by child work alone is dated by when this client saw it instead.
      evidenceObservedAt: isAgentStatusHeldOpenByChildWork(desired) ? Date.now() : summary.updatedAt
    },
    { tabId: tab.id, worktreeId: tab.worktreeId },
    {
      ...(summary.providerSession ? { providerSession: summary.providerSession } : {}),
      terminalResumeEligible: false,
      ...(summary.hostExecutionOwned ? { structuredHostOwned: true as const } : {})
    }
  )
}

function StructuredAgentSessionStatusProjection({
  tab,
  bucket,
  uniquePaneKey
}: OwnedStructuredTab): null {
  const catalog = useAppStore(
    useShallow((state) => ({
      repos: state.repos,
      worktreesByRepo: state.worktreesByRepo,
      folderWorkspaces: state.folderWorkspaces,
      projectGroups: state.projectGroups
    }))
  )
  const target = useMemo(
    () => resolveStructuredSessionRuntimeTarget(catalog, bucket, tab),
    [catalog, bucket, tab]
  )
  const { summary, observation } = useStructuredAgentSessionStatusSummary(tab.entityId, target)
  useEffect(() => {
    const ownedSummary =
      uniquePaneKey &&
      summary &&
      getWorktreeIdFromHostIdentity(summary.workspaceId) === getWorktreeIdFromHostIdentity(bucket)
        ? summary
        : null
    projectStatus(tab, ownedSummary, observation)
  }, [summary, observation, tab, bucket, uniquePaneKey])
  useEffect(
    () => () =>
      useAppStore.getState().removeAgentStatus(structuredAgentSessionPaneKey(tab.id, tab.entityId)),
    [tab.entityId, tab.id]
  )
  return null
}

export function StructuredAgentSessionStatusBridge(): React.JSX.Element {
  const owners = useAppStore(
    useShallow((state) => getStructuredTabOwners(state.unifiedTabsByWorktree).owners)
  )
  return (
    <>
      {owners.map((owner) => (
        <StructuredAgentSessionStatusProjection
          key={JSON.stringify([owner.bucket, owner.tab.id, owner.tab.entityId])}
          {...owner}
        />
      ))}
    </>
  )
}
