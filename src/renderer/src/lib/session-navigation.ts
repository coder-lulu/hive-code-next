import { parseExecutionHostId, type ExecutionHostId } from '../../../shared/execution-host'
import { runtimeHostConnectionState } from '../../../shared/runtime-host-connection-state'
import { parsePaneKey } from '../../../shared/stable-pane-id'
import {
  getExecutionHostIdFromWorktreeHostIdentity,
  getWorktreeIdFromHostIdentity,
  isWorktreeHostIdentity
} from '../../../shared/worktree/host-qualified-identity'
import { collectLeafIds } from '@/components/terminal-pane/terminal-pane-layout-tree'
import type { SessionListItem } from '@/components/sessions/session-list-types'
import type { SessionListStatus } from '@/components/sidebar/session-list-status'
import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import { selectRuntimeAwareSshStatus } from '@/store/slices/runtime-environment-ssh-selectors'
import { activateTabAndFocusPane } from './activate-tab-and-focus-pane'
import { isFloatingTerminalWorkspaceId } from './floating-terminal'
import { activateStructuredAgentSessionTab } from './structured-agent-session-tab-activation'
import { activateTemporarySessionInMain } from './temporary-session-navigation'
import { activateAndRevealWorkspace } from './worktree-activation'
import { resolveExactWorktreeRoute } from './worktree-owner-route'
import { getResolvedExecutionHostIdForWorktree } from './resolved-worktree-execution-host'

export type SessionActivationResult =
  | { ok: true }
  | { ok: false; reason: 'unavailable' | 'ambiguous' | 'disconnected' }

function rawWorkspaceId(bucketKey: string): string {
  return isWorktreeHostIdentity(bucketKey) ? getWorktreeIdFromHostIdentity(bucketKey) : bucketKey
}

/** Read transport from the selected owner, never the currently focused environment. */
export function resolveSessionConnectionState(
  state: AppState,
  ownerBucketKey: string,
  executionHostId: ExecutionHostId
): SessionListStatus['connection'] {
  const host = parseExecutionHostId(executionHostId)
  if (!host) {
    return 'unknown'
  }
  if (host.kind === 'local') {
    return 'connected'
  }
  let environmentId = host.kind === 'runtime' ? host.environmentId : null
  if (host.kind === 'ssh' && !isFloatingTerminalWorkspaceId(ownerBucketKey)) {
    const owner = state.getKnownWorktreeById(rawWorkspaceId(ownerBucketKey), executionHostId)
    if (!owner) {
      return 'unknown'
    }
    const route = resolveExactWorktreeRoute(state, owner)
    if (route.kind !== 'resolved') {
      return 'unknown'
    }
    environmentId = route.route.runtimeEnvironmentId
  }
  if (environmentId) {
    const entry = state.runtimeStatusByEnvironmentId.get(environmentId)
    const connection = runtimeHostConnectionState({
      hasStatusEntry: Boolean(entry),
      status: entry?.status
    })
    if (connection !== 'connected' || host.kind === 'runtime') {
      return connection
    }
  }
  return host.kind === 'ssh'
    ? (selectRuntimeAwareSshStatus(state, environmentId, host.targetId) ?? 'unknown')
    : 'unknown'
}

function resolveCurrentSession(state: AppState, item: SessionListItem) {
  const bucketKey = item.ownerBucketKey
  const host = parseExecutionHostId(item.executionHostId)
  if (!bucketKey || !host) {
    return { error: 'ambiguous' } as const
  }
  const bucketHost = getExecutionHostIdFromWorktreeHostIdentity(bucketKey)
  if (bucketHost && bucketHost !== host.id) {
    return { error: 'ambiguous' } as const
  }
  const workspaceId = rawWorkspaceId(bucketKey)
  // Non-floating host-qualified buckets have no resident workspace surface yet.
  if (bucketKey !== workspaceId && !isFloatingTerminalWorkspaceId(bucketKey)) {
    return { error: 'unavailable' } as const
  }
  if (item.worktreeId && rawWorkspaceId(item.worktreeId) !== workspaceId) {
    return { error: 'unavailable' } as const
  }
  const candidates = (state.unifiedTabsByWorktree[bucketKey] ?? []).filter((tab) =>
    item.unifiedTabId
      ? tab.id === item.unifiedTabId
      : tab.contentType === 'terminal' && tab.entityId === item.terminalTabId
  )
  if (candidates.length > 1) {
    return { error: 'ambiguous' } as const
  }
  const tab = candidates[0]
  const terminalId = tab?.contentType === 'terminal' ? tab.entityId : item.terminalTabId
  const terminals = (state.tabsByWorktree[bucketKey] ?? []).filter((row) => row.id === terminalId)
  if (terminals.length > 1) {
    return { error: 'ambiguous' } as const
  }
  const terminal = terminals[0]
  if ((item.unifiedTabId && !tab) || (!tab && !terminal)) {
    return { error: 'unavailable' } as const
  }
  if (
    (tab && tab.contentType !== (item.kind === 'structured' ? 'agent-session' : 'terminal')) ||
    (item.kind === 'terminal' && !terminal) ||
    (item.terminalTabId && terminalId !== item.terminalTabId)
  ) {
    return { error: 'unavailable' } as const
  }
  for (const source of [tab, terminal]) {
    if (!source) {
      continue
    }
    if (rawWorkspaceId(source.worktreeId) !== workspaceId) {
      return { error: 'ambiguous' } as const
    }
    const sourceHost = getExecutionHostIdFromWorktreeHostIdentity(source.worktreeId)
    if (sourceHost && sourceHost !== host.id) {
      return { error: 'ambiguous' } as const
    }
  }
  if (tab?.executionHostId && tab.executionHostId !== host.id) {
    return { error: 'ambiguous' } as const
  }
  if (!bucketHost && !tab?.executionHostId) {
    const ownerHost = getResolvedExecutionHostIdForWorktree(
      { ...state, activeWorktreeId: null, activeWorkspaceExecutionHostId: null },
      workspaceId
    )
    if (ownerHost !== host.id) {
      return { error: 'ambiguous' } as const
    }
  }
  const pane = item.paneKey ? parsePaneKey(item.paneKey) : null
  if (
    item.paneKey &&
    (!pane ||
      pane.tabId !== terminalId ||
      !collectLeafIds(state.terminalLayoutsByTabId[terminalId!]?.root).includes(pane.leafId))
  ) {
    return { error: 'unavailable' } as const
  }
  const hook = item.paneKey ? state.agentStatusByPaneKey[item.paneKey] : null
  if (
    hook?.providerSession?.id &&
    item.providerSessionId &&
    hook.providerSession.id !== item.providerSessionId
  ) {
    return { error: 'unavailable' } as const
  }
  const providerIds = [
    tab?.structuredSessionId,
    tab?.aiVaultTitle?.sessionId,
    terminal?.aiVaultTitle?.sessionId
  ]
  if (tab?.contentType === 'agent-session') {
    providerIds.push(tab.entityId)
  }
  if (hook?.providerSession?.id) {
    providerIds.push(hook.providerSession.id)
  }
  if (item.providerSessionId && !providerIds.includes(item.providerSessionId)) {
    return { error: 'unavailable' } as const
  }
  if (
    tab &&
    !(state.groupsByWorktree[bucketKey] ?? []).some(
      (group) => group.id === tab.groupId && group.tabOrder.includes(tab.id)
    )
  ) {
    return { error: 'unavailable' } as const
  }
  if (
    !isFloatingTerminalWorkspaceId(bucketKey) &&
    !state.getKnownWorktreeById(workspaceId, host.id)
  ) {
    return { error: 'unavailable' } as const
  }
  return { bucketKey, workspaceId, executionHostId: host.id, tab, terminal, pane }
}

export async function activateSessionInWorkspace(
  item: SessionListItem
): Promise<SessionActivationResult> {
  const state = useAppStore.getState()
  const target = resolveCurrentSession(state, item)
  if (target.error) {
    return { ok: false, reason: target.error }
  }
  if (
    resolveSessionConnectionState(state, target.bucketKey, target.executionHostId) !== 'connected'
  ) {
    return { ok: false, reason: 'disconnected' }
  }
  const activated = isFloatingTerminalWorkspaceId(target.bucketKey)
    ? activateTemporarySessionInMain({
        ownerBucketKey: target.bucketKey,
        executionHostId: target.executionHostId,
        unifiedTabId: target.tab?.id,
        terminalTabId: target.terminal?.id
      })
    : activateAndRevealWorkspace(target.workspaceId, {
        executionHostId: target.executionHostId,
        providesInitialSurface: true,
        clearSidebarFilters: false
      }) !== false
  if (!activated) {
    return { ok: false, reason: 'unavailable' }
  }
  const current = useAppStore.getState()
  const refreshed = resolveCurrentSession(current, item)
  if (refreshed.error) {
    return { ok: false, reason: refreshed.error }
  }
  if (refreshed.tab?.contentType === 'agent-session') {
    if (isFloatingTerminalWorkspaceId(target.bucketKey)) {
      return { ok: true }
    }
    return activateStructuredAgentSessionTab({
      worktreeId: target.workspaceId,
      tabId: refreshed.tab.id,
      executionHostId: target.executionHostId
    })
      ? { ok: true }
      : { ok: false, reason: 'unavailable' }
  }
  if (refreshed.tab) {
    current.focusGroup(target.bucketKey, refreshed.tab.groupId)
    current.activateTab(refreshed.tab.id, { worktreeId: target.bucketKey })
  }
  if (refreshed.terminal) {
    current.setActiveTabForWorktree(target.bucketKey, refreshed.terminal.id)
    if (current.activeWorktreeId === target.bucketKey) {
      activateTabAndFocusPane(refreshed.terminal.id, refreshed.pane?.leafId ?? null)
    } else {
      current.setActiveTabType('terminal', target.bucketKey)
    }
  }
  return { ok: true }
}
