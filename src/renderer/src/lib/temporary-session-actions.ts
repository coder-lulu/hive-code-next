import { closeTerminalTab } from '@/components/terminal/terminal-tab-actions'
import { getWorktreeTerminalTabIds } from '@/components/terminal/terminal-close-target'
import { useAppStore } from '@/store'
import { buildTerminalTabRetirementPlan } from '@/store/slices/terminal-tab-retirement'
import { guardPinnedTabClose, resolvePinnedTabLabel } from '@/store/pinned-tab-close-guard'
import { callRuntimeRpc, type RuntimeClientTarget } from '@/runtime/runtime-rpc-client'
import { closeStructuredAgentSession } from '@/runtime/structured-agent-session-close'
import { toRuntimeWorktreeSelector } from '@/runtime/runtime-worktree-selector'
import { parseExecutionHostId } from '../../../shared/execution-host'
import {
  getWorktreeIdFromHostIdentity,
  isWorktreeHostIdentity
} from '../../../shared/worktree/host-qualified-identity'
import {
  resolveTemporarySessionOwner,
  type TemporarySessionNavigationTarget,
  type TemporarySessionOwner
} from './temporary-session-navigation'

export type TemporarySessionDeleteTarget = TemporarySessionNavigationTarget & {
  paneKey?: string | null
}

function runtimeTargetForHost(executionHostId: string): RuntimeClientTarget {
  const parsed = parseExecutionHostId(executionHostId)
  return parsed?.kind === 'runtime'
    ? { kind: 'environment', environmentId: parsed.environmentId }
    : { kind: 'local' }
}

function rawWorktreeId(bucketKey: string): string {
  return isWorktreeHostIdentity(bucketKey) ? getWorktreeIdFromHostIdentity(bucketKey) : bucketKey
}

function closeOwnedTerminalTab(
  state: ReturnType<typeof useAppStore.getState>,
  owner: TemporarySessionOwner,
  terminalTabId: string,
  options?: {
    force?: boolean
    skipRunningProcessConfirm?: boolean
    structuredSessionCloseConfirmed?: boolean
  }
): void {
  // Closing by tab id alone is ambiguous when two Runtime hosts expose the
  // same provider id. Build the retirement plan from the exact owner bucket
  // selected by the sidebar row and pass that ownership through the shared
  // close path.
  const scopedState = {
    ...state,
    tabsByWorktree: {
      [owner.bucketKey]: state.tabsByWorktree[owner.bucketKey] ?? []
    },
    unifiedTabsByWorktree: {
      [owner.bucketKey]: state.unifiedTabsByWorktree[owner.bucketKey] ?? []
    }
  }
  const terminalIds = getWorktreeTerminalTabIds(scopedState, owner.bucketKey)
  const currentIndex = terminalIds.indexOf(terminalTabId)
  const nextTerminalTabId = terminalIds[currentIndex + 1] ?? terminalIds[currentIndex - 1] ?? null
  const retirementPlan = buildTerminalTabRetirementPlan(scopedState, terminalTabId)
  closeTerminalTab(terminalTabId, {
    ...options,
    precomputedRetirementPlan: retirementPlan,
    precomputedCloseState: {
      owningWorktreeId: owner.bucketKey,
      terminalCountBeforeClose: terminalIds.length,
      nextTerminalTabId
    }
  })
}

/**
 * Delete a temporary session through the same host/provider retirement paths
 * used by workspace tabs. Returns false when the row is stale and no longer
 * resolves to a live tab.
 */
export async function deleteTemporarySession(
  target: TemporarySessionDeleteTarget
): Promise<boolean> {
  const state = useAppStore.getState()
  const owner = resolveTemporarySessionOwner(state, target)
  if (!owner) {
    if (target.paneKey) {
      state.dropAgentStatus(target.paneKey)
      return true
    }
    return false
  }

  if (!owner.structured) {
    if (!owner.terminalTabId) {
      return false
    }
    closeOwnedTerminalTab(state, owner, owner.terminalTabId)
    return true
  }

  const unifiedTabId = owner.unifiedTabId
  if (!unifiedTabId) {
    return false
  }
  const unifiedTab = (state.unifiedTabsByWorktree[owner.bucketKey] ?? []).find(
    (tab) => tab.id === unifiedTabId && tab.contentType === 'agent-session'
  )
  if (!unifiedTab) {
    return false
  }

  const closeStructuredSession = async (): Promise<boolean> => {
    const runtimeTarget = runtimeTargetForHost(owner.executionHostId)
    await closeStructuredAgentSession(runtimeTarget, unifiedTab.entityId)
    await callRuntimeRpc(runtimeTarget, 'session.tabs.close', {
      worktree: toRuntimeWorktreeSelector(rawWorktreeId(owner.bucketKey)),
      tabId: `agent-session:${unifiedTab.entityId}`,
      reason: 'user'
    })

    // A migrated native chat may still have a legacy terminal mirror. Retire it
    // only after the provider confirms closure so failed network requests remain
    // recoverable instead of becoming a local-only disappearance.
    if (owner.terminalTabId) {
      closeOwnedTerminalTab(state, owner, owner.terminalTabId, {
        force: true,
        skipRunningProcessConfirm: true,
        structuredSessionCloseConfirmed: true
      })
    }
    state.closeUnifiedTab(unifiedTabId)
    return true
  }

  if (!unifiedTab.isPinned) {
    return closeStructuredSession()
  }
  return new Promise<boolean>((resolve, reject) => {
    guardPinnedTabClose({
      isPinned: true,
      tabLabel: resolvePinnedTabLabel(state, owner.bucketKey, unifiedTab.id),
      onClose: () => {
        void closeStructuredSession().then(resolve, reject)
      },
      // Cancellation is a handled user decision, not a stale-row failure.
      onCancel: () => resolve(true)
    })
  })
}
