import { getRuntimeEnvironmentIdForWorktree } from './worktree-runtime-owner'
import { useAppStore } from '@/store'
import { callRuntimeRpc, getActiveRuntimeTarget } from '@/runtime/runtime-rpc-client'
import { toRuntimeWorktreeSelector } from '@/runtime/runtime-worktree-selector'
import { LOCAL_EXECUTION_HOST_ID, type ExecutionHostId } from '../../../shared/execution-host'
import type { Tab } from '../../../shared/tab-types'
import {
  getExecutionHostIdFromWorktreeHostIdentity,
  getWorktreeIdFromHostIdentity,
  isWorktreeHostIdentity
} from '../../../shared/worktree/host-qualified-identity'

type StructuredAgentTabOwner = {
  tab: Tab
  /** The key used by the unified-tab store bucket. */
  bucketKey: string
}

function rawWorktreeId(worktreeId: string): string {
  return isWorktreeHostIdentity(worktreeId) ? getWorktreeIdFromHostIdentity(worktreeId) : worktreeId
}

function bucketMatchesWorkspace(
  bucketKey: string,
  tab: Pick<Tab, 'worktreeId' | 'executionHostId'>,
  requestedWorktreeId: string,
  requestedHostId?: ExecutionHostId | null
): boolean {
  const requestedRawId = rawWorktreeId(requestedWorktreeId)
  const bucketRawId = rawWorktreeId(bucketKey)
  const tabRawId = rawWorktreeId(tab.worktreeId)
  if (bucketRawId !== requestedRawId && tabRawId !== requestedRawId) {
    return false
  }
  if (!requestedHostId) {
    return true
  }
  const ownerHostId =
    tab.executionHostId ??
    getExecutionHostIdFromWorktreeHostIdentity(tab.worktreeId) ??
    getExecutionHostIdFromWorktreeHostIdentity(bucketKey) ??
    LOCAL_EXECUTION_HOST_ID
  return ownerHostId === requestedHostId
}

function findStructuredAgentTab(
  state: ReturnType<typeof useAppStore.getState>,
  args: {
    worktreeId: string
    tabId?: string
    sessionId?: string
    executionHostId?: ExecutionHostId | null
  }
): StructuredAgentTabOwner | null {
  const requestedRawId = rawWorktreeId(args.worktreeId)
  const requestedHostId =
    args.executionHostId ?? getExecutionHostIdFromWorktreeHostIdentity(args.worktreeId)
  const preferredKeys = [
    args.executionHostId ? `${args.executionHostId}|${requestedRawId}` : null,
    args.worktreeId,
    requestedRawId
  ].filter((key): key is string => Boolean(key))
  const buckets = [
    ...preferredKeys.map((key) => [key, state.unifiedTabsByWorktree[key] ?? []] as const),
    ...Object.entries(state.unifiedTabsByWorktree).filter(([key]) => !preferredKeys.includes(key))
  ]
  const matches: StructuredAgentTabOwner[] = []
  for (const [bucketKey, tabs] of buckets) {
    const tab = tabs.find(
      (candidate) =>
        candidate.contentType === 'agent-session' &&
        (args.tabId === undefined || candidate.id === args.tabId) &&
        (args.sessionId === undefined ||
          candidate.entityId === args.sessionId ||
          candidate.structuredSessionId === args.sessionId ||
          candidate.aiVaultTitle?.sessionId === args.sessionId) &&
        bucketMatchesWorkspace(bucketKey, candidate, args.worktreeId, requestedHostId)
    )
    if (tab) {
      matches.push({ tab, bucketKey })
    }
  }
  if (matches.length === 0) {
    return null
  }
  if (!requestedHostId) {
    const hostIds = new Set(
      matches
        .map(
          ({ tab, bucketKey }) =>
            tab.executionHostId ?? getExecutionHostIdFromWorktreeHostIdentity(bucketKey)
        )
        .filter((hostId): hostId is ExecutionHostId => Boolean(hostId))
    )
    if (hostIds.size > 1) {
      return null
    }
  }
  return matches[0]
}

export function activateStructuredAgentSessionTab(args: {
  worktreeId: string
  tabId: string
  executionHostId?: ExecutionHostId | null
}): boolean {
  const state = useAppStore.getState()
  const owner = findStructuredAgentTab(state, args)
  if (!owner) {
    return false
  }
  const { tab, bucketKey } = owner
  const runtimeWorktreeId = rawWorktreeId(args.worktreeId)
  state.focusGroup(bucketKey, tab.groupId)
  state.activateTab(tab.id, { worktreeId: bucketKey })
  state.setActiveTabType('agent-session', bucketKey)
  const environmentId = getRuntimeEnvironmentIdForWorktree(state, runtimeWorktreeId)
  void callRuntimeRpc(
    getActiveRuntimeTarget({ activeRuntimeEnvironmentId: environmentId }),
    'session.tabs.activate',
    {
      worktree: toRuntimeWorktreeSelector(runtimeWorktreeId),
      tabId: `agent-session:${tab.entityId}`
    }
  )
  return true
}

export function activateStructuredAgentSessionById(args: {
  worktreeId: string
  sessionId: string
  executionHostId?: ExecutionHostId | null
}): boolean {
  const state = useAppStore.getState()
  const owner = findStructuredAgentTab(state, args)
  return owner
    ? activateStructuredAgentSessionTab({
        worktreeId: args.worktreeId,
        tabId: owner.tab.id,
        executionHostId: args.executionHostId
      })
    : false
}
