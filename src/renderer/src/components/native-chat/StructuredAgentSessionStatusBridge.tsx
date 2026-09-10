import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { agentProviderSessionsEqual } from '../../../../shared/agent-session-resume'
import type { AgentSessionStatusSummary } from '../../../../shared/agent-session-wire'
import { structuredAgentSessionPaneKey } from '../../../../shared/structured-agent-session-projection'
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
function useStructuredAgentSessionStatusSummary(
  sessionId: string,
  target: RuntimeClientTarget | null
): AgentSessionStatusSummary | null {
  const feed = useMemo(
    () => (target ? getStructuredAgentSessionStatusFeed(target) : null),
    [target]
  )
  useEffect(() => feed?.activate(), [feed])
  return useSyncExternalStore(
    feed?.subscribe ?? subscribeEmpty,
    () => feed?.getSnapshot().get(sessionId) ?? null,
    () => null
  )
}

function projectStatus(tab: StructuredTab, summary: AgentSessionStatusSummary | null): void {
  const paneKey = structuredAgentSessionPaneKey(tab.id, tab.entityId)
  const store = useAppStore.getState()
  // No persisted turn yet (or nothing known): the row shows no agent status at all.
  if (!summary?.status) {
    if (store.agentStatusByPaneKey?.[paneKey]) {
      store.removeAgentStatus(paneKey)
    }
    return
  }
  const desired = {
    state:
      summary.status === 'working'
        ? 'working'
        : summary.status === 'attention'
          ? 'blocked'
          : 'done',
    prompt: summary.latestPrompt,
    agentType: tab.agentSessionAgent,
    // The host projects these from the journal so the row reads like a hook-reported one:
    // the running tool while a turn is live, the agent's last words once it settles.
    ...(summary.model ? { model: summary.model } : {}),
    ...(summary.toolName ? { toolName: summary.toolName } : {}),
    ...(summary.toolInput ? { toolInput: summary.toolInput } : {}),
    ...(summary.lastAssistantMessage ? { lastAssistantMessage: summary.lastAssistantMessage } : {}),
    sessionBoundary: false
  } as const
  const current = store.agentStatusByPaneKey?.[paneKey]
  if (
    current?.state === desired.state &&
    current.prompt === desired.prompt &&
    current.agentType === desired.agentType &&
    // A row keeps the last model it was told about, so only a reported one can differ.
    (summary.model === undefined || current.model === summary.model) &&
    current.toolName === summary.toolName &&
    current.toolInput === summary.toolInput &&
    current.lastAssistantMessage === summary.lastAssistantMessage &&
    current.sessionBoundary === desired.sessionBoundary &&
    current.updatedAt === summary.updatedAt &&
    current.terminalTitle === tab.label &&
    current.tabId === tab.id &&
    current.worktreeId === tab.worktreeId &&
    current.terminalResumeEligible === false &&
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
      stateStartedAt:
        desired.state !== 'done' && current?.state === desired.state
          ? current.stateStartedAt
          : summary.updatedAt,
      evidenceObservedAt: Date.now()
    },
    { tabId: tab.id, worktreeId: tab.worktreeId },
    {
      ...(summary.providerSession ? { providerSession: summary.providerSession } : {}),
      terminalResumeEligible: false
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
  const summary = useStructuredAgentSessionStatusSummary(tab.entityId, target)
  useEffect(() => {
    // The legacy pane map cannot represent two owners sharing the same tab/session ids.
    const ownedSummary =
      uniquePaneKey &&
      summary &&
      getWorktreeIdFromHostIdentity(summary.workspaceId) === getWorktreeIdFromHostIdentity(bucket)
        ? summary
        : null
    projectStatus(tab, ownedSummary)
  }, [summary, tab, bucket, uniquePaneKey])
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
