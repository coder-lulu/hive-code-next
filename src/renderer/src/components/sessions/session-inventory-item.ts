import type { AgentStatusEntry } from '../../../../shared/agent-status-types'
import { LOCAL_EXECUTION_HOST_ID, type ExecutionHostId } from '../../../../shared/execution-host'
import type { Tab } from '../../../../shared/tab-types'
import type { TerminalTab } from '../../../../shared/terminal-tab-types'
import {
  composeWorktreeHostIdentity,
  getExecutionHostIdFromWorktreeHostIdentity,
  getWorktreeIdFromHostIdentity
} from '../../../../shared/worktree/host-qualified-identity'
import type { DesktopHomeEntityProjection } from '../landing/desktop-home-model-entities'
import {
  isFloatingWorktreeId,
  timestamp,
  titleForTerminalTab,
  titleForUnifiedTab
} from '../sidebar/sidebar-session-projection'
import type { SessionListItem } from './session-list-types'

function resolveHost(
  entities: DesktopHomeEntityProjection,
  bucket: string,
  tab?: Tab
): ExecutionHostId | null {
  const bucketHost = getExecutionHostIdFromWorktreeHostIdentity(bucket)
  const tabHost =
    tab?.executionHostId ?? getExecutionHostIdFromWorktreeHostIdentity(tab?.worktreeId ?? '')
  if (bucketHost && tabHost && bucketHost !== tabHost) {
    return null
  }
  if (bucketHost || tabHost) {
    return bucketHost ?? tabHost ?? null
  }
  if (isFloatingWorktreeId(bucket)) {
    return LOCAL_EXECUTION_HOST_ID
  }
  const matches = entities.workspaces.filter(
    (workspace) =>
      workspace.workspaceKey === bucket ||
      workspace.identityKey === bucket ||
      (workspace.kind === 'worktree' && workspace.id === bucket)
  )
  return matches.length === 1 ? matches[0].executionHostId : null
}

export function createSessionInventoryItem(
  entities: DesktopHomeEntityProjection,
  bucket: string,
  tab: Tab | undefined,
  terminal: TerminalTab | undefined
): SessionListItem {
  const host = resolveHost(entities, bucket, tab)
  const worktreeId = getWorktreeIdFromHostIdentity(bucket)
  const owner = host ? composeWorktreeHostIdentity(host, worktreeId) : null
  const workspace = entities.workspaces.find((entry) => entry.identityKey === owner)
  const assignment = tab?.projectAssignment ?? terminal?.projectAssignment
  const assignedProject = assignment
    ? entities.projectsByIdentity.get(assignment.projectIdentityKey)
    : undefined
  const project =
    assignedProject &&
    assignedProject.id === assignment?.projectId &&
    assignedProject.executionHostId === host &&
    assignment.executionHostId === host
      ? assignedProject
      : [...entities.projectsByIdentity.values()].find(
          (entry) =>
            entry.executionHostId === host &&
            entry.workspaces.some((candidate) => candidate.identityKey === owner)
        )
  const providerSessionId =
    tab?.aiVaultTitle?.sessionId ?? terminal?.aiVaultTitle?.sessionId ?? null
  const backingId = tab?.entityId ?? terminal!.id
  return {
    key: `${bucket}|${tab?.id ?? terminal!.id}`,
    id: providerSessionId ?? backingId,
    title: tab ? titleForUnifiedTab(tab) : titleForTerminalTab(terminal!),
    kind: tab?.contentType === 'agent-session' ? 'structured' : 'terminal',
    worktreeId,
    ownerBucketKey: bucket,
    unifiedTabId: tab?.id ?? null,
    terminalTabId: terminal?.id ?? null,
    tabId: tab?.id ?? terminal?.id ?? null,
    paneKey: null,
    executionHostId: host,
    providerSessionId,
    agent:
      tab?.agentSessionAgent ??
      terminal?.launchAgent ??
      tab?.aiVaultTitle?.agent ??
      terminal?.aiVaultTitle?.agent ??
      null,
    groupId: tab?.groupId ?? null,
    projectAssignment: assignment,
    projectKey: project?.identityKey ?? null,
    projectLabel: project?.name ?? null,
    workspaceLabel: workspace?.name ?? null,
    workspacePath: workspace?.path ?? null,
    contextLabel: workspace?.name,
    hostLabel: host ?? '',
    lastActivityAt: Math.max(timestamp(tab?.createdAt), timestamp(terminal?.createdAt)),
    status: {
      activity: 'unknown',
      reason: null,
      lastActivityAt: null,
      connection: 'unknown',
      execution: 'unverifiable',
      executionReason: null
    }
  }
}

/** A current pane observation may supersede cached conversation metadata, never the tab identity. */
export function applyCurrentSessionProvider(
  item: SessionListItem,
  tab: Tab | undefined,
  terminal: TerminalTab | undefined,
  hook: AgentStatusEntry
): SessionListItem {
  const providerSessionId = hook.providerSession!.id
  const currentAgent = hook.agentType && hook.agentType !== 'unknown' ? hook.agentType : null
  const replacedProvider =
    item.providerSessionId !== null &&
    (item.providerSessionId !== providerSessionId ||
      (currentAgent !== null && item.agent !== null && currentAgent !== item.agent))
  const title = tab
    ? titleForUnifiedTab({
        ...tab,
        ...(replacedProvider ? { aiVaultTitle: null, generatedLabel: null } : {})
      })
    : titleForTerminalTab({
        ...terminal!,
        ...(replacedProvider ? { aiVaultTitle: null, generatedTitle: null } : {})
      })
  return {
    ...item,
    id: providerSessionId,
    providerSessionId,
    paneKey: hook.paneKey,
    title,
    agent: currentAgent ?? (replacedProvider ? null : item.agent)
  }
}

/** Provider tokens are scoped by both the execution owner and provider namespace. */
export function deduplicateSessionInventory(items: readonly SessionListItem[]): SessionListItem[] {
  const canonical = new Map<string, SessionListItem>()
  for (const item of items) {
    const identity =
      item.executionHostId && item.providerSessionId && item.agent
        ? JSON.stringify([
            item.executionHostId,
            item.worktreeId,
            item.agent,
            item.providerSessionId
          ])
        : item.key
    const previous = canonical.get(identity)
    if (!previous) {
      canonical.set(identity, item)
      continue
    }
    const rank = (value: SessionListItem): number =>
      value.kind === 'structured' ? 2 : value.unifiedTabId ? 1 : 0
    const winner =
      rank(item) > rank(previous) || (rank(item) === rank(previous) && item.key < previous.key)
        ? item
        : previous
    canonical.set(identity, {
      ...winner,
      lastActivityAt: Math.max(item.lastActivityAt, previous.lastActivityAt)
    })
  }
  return [...canonical.values()]
}
