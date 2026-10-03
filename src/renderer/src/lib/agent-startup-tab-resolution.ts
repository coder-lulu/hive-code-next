import type { useAppStore } from '@/store'
import {
  isWebTerminalSurfaceTabId,
  toWebTerminalSurfaceTabId
} from '@/runtime/web-terminal-surface-id'
import { parsePaneKey } from '../../../shared/stable-pane-id'
import { getRuntimeEnvironmentIdForWorktree } from './worktree-runtime-owner'

type AppStoreSnapshot = ReturnType<typeof useAppStore.getState>

export function resolveAgentStartupTabId(
  state: AppStoreSnapshot,
  worktreeId: string,
  primaryTabId: string | null | undefined
): string | null {
  // Why: the caller may know the exact tab that received the queued startup
  // command. Prefer it over focus-derived state, which can change mid-create.
  if (primaryTabId) {
    const tabs = state.tabsByWorktree[worktreeId] ?? []
    if (tabs.some((tab) => tab.id === primaryTabId)) {
      return primaryTabId
    }
    const mirroredTabId = isWebTerminalSurfaceTabId(primaryTabId)
      ? primaryTabId
      : toWebTerminalSurfaceTabId(primaryTabId)
    if (tabs.some((tab) => tab.id === mirroredTabId)) {
      return mirroredTabId
    }
    if (
      !isWebTerminalSurfaceTabId(primaryTabId) &&
      getRuntimeEnvironmentIdForWorktree(state, worktreeId)
    ) {
      // A paired Host can return its raw tab id before the Renderer has
      // materialized the mirrored surface. Bind the follow-up to that future
      // surface now instead of queueing against an id this store will never own.
      return mirroredTabId
    }
  }
  return (
    primaryTabId ??
    state.activeTabIdByWorktree[worktreeId] ??
    state.tabsByWorktree[worktreeId]?.[0]?.id ??
    null
  )
}

export function getAgentStartupTabPtyId(
  state: AppStoreSnapshot,
  tabId: string,
  launchToken: string
): string | null {
  const livePtyIds = new Set(state.ptyIdsByTabId[tabId] ?? [])
  if (livePtyIds.size === 0) {
    return null
  }
  for (const [paneKey, entry] of Object.entries(state.agentLaunchConfigByPaneKey ?? {})) {
    const identity = entry.identity
    if (identity.tabId !== tabId || identity.launchToken !== launchToken) {
      continue
    }
    const leafId = identity.leafId ?? parsePaneKey(paneKey)?.leafId
    if (!leafId) {
      continue
    }
    const ptyId = state.terminalLayoutsByTabId[tabId]?.ptyIdsByLeafId?.[leafId]
    if (ptyId && livePtyIds.has(ptyId)) {
      return ptyId
    }
  }
  return null
}
