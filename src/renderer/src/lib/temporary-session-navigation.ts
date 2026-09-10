import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../shared/constants'
import { LOCAL_EXECUTION_HOST_ID, type ExecutionHostId } from '../../../shared/execution-host'
import {
  getExecutionHostIdFromWorktreeHostIdentity,
  getWorktreeIdFromHostIdentity,
  isWorktreeHostIdentity
} from '../../../shared/worktree/host-qualified-identity'
import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import { activateStructuredAgentSessionTab } from './structured-agent-session-tab-activation'
import { CLOSE_FLOATING_TERMINAL_EVENT, isFloatingTerminalWorkspaceId } from './floating-terminal'

type TemporarySessionNavigationState = Pick<
  AppState,
  | 'activateTab'
  | 'setActiveRepo'
  | 'setActiveTab'
  | 'setActiveTabType'
  | 'setActiveView'
  | 'setActiveWorktree'
>

type TemporarySessionLookupState = Pick<AppState, 'tabsByWorktree' | 'unifiedTabsByWorktree'>

export type TemporarySessionOwner = {
  /** Exact store bucket. Remote mirrors use a host-qualified identity. */
  bucketKey: string
  executionHostId: ExecutionHostId
  structured: boolean
  unifiedTabId: string | null
  terminalTabId: string | null
}

export type TemporarySessionNavigationTarget = {
  ownerBucketKey?: string | null
  sessionId?: string | null
  unifiedTabId?: string | null
  terminalTabId?: string | null
  /** Legacy preferred identity used by callers that predate split tab ids. */
  tabId?: string | null
  executionHostId?: ExecutionHostId | null
}

function bucketExecutionHostId(bucketKey: string): ExecutionHostId {
  return getExecutionHostIdFromWorktreeHostIdentity(bucketKey) ?? LOCAL_EXECUTION_HOST_ID
}

function normalizedTarget(
  target: string | TemporarySessionNavigationTarget,
  executionHostId?: ExecutionHostId | null
): TemporarySessionNavigationTarget {
  return typeof target === 'string' ? { tabId: target, executionHostId } : target
}

function bucketContainsTarget(
  state: TemporarySessionLookupState,
  bucketKey: string,
  target: TemporarySessionNavigationTarget
):
  | (Omit<TemporarySessionOwner, 'bucketKey' | 'executionHostId'> & {
      executionHostId: ExecutionHostId | null
    })
  | null {
  const candidateIds = new Set(
    [target.tabId, target.unifiedTabId, target.terminalTabId].filter((value): value is string =>
      Boolean(value)
    )
  )
  const unified = (state.unifiedTabsByWorktree[bucketKey] ?? []).find((tab) => {
    if (candidateIds.has(tab.id)) {
      return true
    }
    if (tab.contentType === 'terminal' && candidateIds.has(tab.entityId)) {
      return true
    }
    return Boolean(
      target.sessionId &&
      (tab.entityId === target.sessionId ||
        tab.structuredSessionId === target.sessionId ||
        tab.aiVaultTitle?.sessionId === target.sessionId)
    )
  })
  const terminal = (state.tabsByWorktree[bucketKey] ?? []).find(
    (tab) =>
      candidateIds.has(tab.id) ||
      Boolean(target.sessionId && tab.aiVaultTitle?.sessionId === target.sessionId)
  )
  if (!unified && !terminal) {
    return null
  }
  return {
    structured: unified?.contentType === 'agent-session',
    unifiedTabId: unified?.id ?? null,
    terminalTabId: terminal?.id ?? (unified?.contentType === 'terminal' ? unified.entityId : null),
    executionHostId:
      unified?.executionHostId ??
      (unified?.worktreeId
        ? getExecutionHostIdFromWorktreeHostIdentity(unified.worktreeId)
        : null) ??
      (terminal?.worktreeId
        ? getExecutionHostIdFromWorktreeHostIdentity(terminal.worktreeId)
        : null) ??
      null
  }
}

/** Resolve a tab to its exact synthetic workspace bucket without guessing across hosts. */
export function resolveTemporarySessionOwner(
  state: TemporarySessionLookupState,
  targetInput: string | TemporarySessionNavigationTarget,
  executionHostId?: ExecutionHostId | null,
  options?: { allowWorkspaceOwner?: boolean }
): TemporarySessionOwner | null {
  const target = normalizedTarget(targetInput, executionHostId)
  const bucketKeys = target.ownerBucketKey
    ? new Set([target.ownerBucketKey])
    : new Set([...Object.keys(state.tabsByWorktree), ...Object.keys(state.unifiedTabsByWorktree)])
  const matches: TemporarySessionOwner[] = []
  for (const bucketKey of bucketKeys) {
    if (
      !isFloatingTerminalWorkspaceId(bucketKey) &&
      !(options?.allowWorkspaceOwner && target.ownerBucketKey && target.executionHostId)
    ) {
      continue
    }
    const match = bucketContainsTarget(state, bucketKey, target)
    if (!match) {
      continue
    }
    const hostId = match.executionHostId ?? bucketExecutionHostId(bucketKey)
    const requestedHostId = target.executionHostId ?? executionHostId
    if (requestedHostId && hostId !== requestedHostId) {
      continue
    }
    matches.push({
      bucketKey,
      structured: match.structured,
      unifiedTabId: match.unifiedTabId,
      terminalTabId: match.terminalTabId,
      executionHostId: hostId
    })
  }
  if (matches.length === 1) {
    return matches[0]
  }
  if (matches.length === 0) {
    return null
  }
  const matchingHostIds = new Set(matches.map((owner) => owner.executionHostId))
  if (matchingHostIds.size !== 1) {
    // Identical ids owned by different hosts are genuinely ambiguous. Never
    // let insertion order select a different machine's session.
    return null
  }
  const [matchingHostId] = matchingHostIds
  const qualifiedMatches = matches.filter(
    (owner) => getExecutionHostIdFromWorktreeHostIdentity(owner.bucketKey) === matchingHostId
  )
  if (qualifiedMatches.length === 1) {
    // A compatibility snapshot can duplicate the same remote tab in the raw
    // floating bucket. The host-qualified bucket is the authoritative owner.
    return qualifiedMatches[0]
  }
  if (matchingHostId === LOCAL_EXECUTION_HOST_ID) {
    return matches.find((owner) => owner.bucketKey === FLOATING_TERMINAL_WORKTREE_ID) ?? null
  }
  return null
}

export function applyTemporarySessionMainActivation(
  state: TemporarySessionNavigationState,
  tabId?: string | null,
  owner: Pick<TemporarySessionOwner, 'bucketKey' | 'executionHostId'> = {
    bucketKey: FLOATING_TERMINAL_WORKTREE_ID,
    executionHostId: LOCAL_EXECUTION_HOST_ID
  }
): void {
  state.setActiveRepo(null)
  state.setActiveView('terminal')
  state.setActiveWorktree(owner.bucketKey, owner.executionHostId)
  if (!tabId) {
    return
  }
  state.activateTab(tabId, { worktreeId: owner.bucketKey })
  state.setActiveTab(tabId)
  state.setActiveTabType('terminal')
}

export function activateTemporarySessionInMain(
  targetInput?: string | TemporarySessionNavigationTarget | null,
  executionHostId?: ExecutionHostId | null
): boolean {
  const state = useAppStore.getState()
  const target = targetInput ? normalizedTarget(targetInput, executionHostId) : null
  const owner: TemporarySessionOwner | null = target
    ? resolveTemporarySessionOwner(state, target)
    : {
        bucketKey: FLOATING_TERMINAL_WORKTREE_ID,
        executionHostId: LOCAL_EXECUTION_HOST_ID,
        structured: false,
        unifiedTabId: null,
        terminalTabId: null
      }
  // Never downgrade an ambiguous or missing remote identity into the local
  // bucket. The caller can retain its current surface and try again after the
  // host snapshot hydrates.
  if (!owner) {
    return false
  }
  window.dispatchEvent(new Event(CLOSE_FLOATING_TERMINAL_EVENT))
  applyTemporarySessionMainActivation(state, null, owner)
  if (!target) {
    return true
  }
  // setActiveWorktree reconciles legacy terminal-only snapshots into unified
  // tabs synchronously. Resolve again so activation uses that newly-created
  // tab instead of the stale pre-reconciliation owner descriptor.
  const refreshedOwner = resolveTemporarySessionOwner(useAppStore.getState(), {
    ...target,
    ownerBucketKey: owner.bucketKey,
    executionHostId: owner.executionHostId
  })
  if (!refreshedOwner) {
    return false
  }
  if (refreshedOwner.structured && refreshedOwner.unifiedTabId) {
    const rawWorktreeId = isWorktreeHostIdentity(owner.bucketKey)
      ? getWorktreeIdFromHostIdentity(owner.bucketKey)
      : owner.bucketKey
    if (
      activateStructuredAgentSessionTab({
        worktreeId: rawWorktreeId,
        tabId: refreshedOwner.unifiedTabId,
        executionHostId: refreshedOwner.executionHostId
      })
    ) {
      return true
    }
  }
  const refreshedState = useAppStore.getState()
  if (refreshedOwner.unifiedTabId) {
    refreshedState.activateTab(refreshedOwner.unifiedTabId, {
      worktreeId: refreshedOwner.bucketKey
    })
  }
  if (refreshedOwner.terminalTabId) {
    refreshedState.setActiveTab(refreshedOwner.terminalTabId)
  }
  refreshedState.setActiveTabType(refreshedOwner.structured ? 'agent-session' : 'terminal')
  return Boolean(refreshedOwner.unifiedTabId || refreshedOwner.terminalTabId)
}
