import { useAppStore } from '@/store'
import {
  isWebTerminalSurfaceTabId,
  toWebTerminalSurfaceTabId
} from '@/runtime/web-terminal-surface-id'
import type { AgentStartupPlan } from '@/lib/tui-agent-startup'
import { makePaneKey } from '../../../shared/stable-pane-id'
import { getRuntimeEnvironmentIdForWorktree } from './worktree-runtime-owner'

type AppStoreSnapshot = ReturnType<typeof useAppStore.getState>

export function worktreeStillOwnsStartupTab(
  state: AppStoreSnapshot,
  worktreeId: string,
  tabId: string
): boolean {
  return (state.tabsByWorktree[worktreeId] ?? []).some((tab) => tab.id === tabId)
}

export function bindHostAgentStartupLaunch(args: {
  worktreeId: string
  tabId: string
  launchToken: string
  startup: AgentStartupPlan
  hostPane?: { tabId: string; leafId: string }
}): 'unavailable' | 'bound' | 'conflict' {
  const { hostPane } = args
  if (!hostPane) {
    return 'unavailable'
  }
  // Why: delayed startup flushes can bind several queued launches in one
  // synchronous pass. Re-read the store for each bind so the first token's
  // registration is authoritative before a competing token is considered.
  const state = useAppStore.getState()
  const runtimeEnvironmentId = getRuntimeEnvironmentIdForWorktree(state, args.worktreeId)
  const expectedTabId =
    runtimeEnvironmentId && !isWebTerminalSurfaceTabId(hostPane.tabId)
      ? toWebTerminalSurfaceTabId(hostPane.tabId)
      : hostPane.tabId
  if (
    args.tabId !== expectedTabId ||
    !worktreeStillOwnsStartupTab(state, args.worktreeId, args.tabId)
  ) {
    return 'unavailable'
  }
  const panePtyId = state.terminalLayoutsByTabId[args.tabId]?.ptyIdsByLeafId?.[hostPane.leafId]
  if (!panePtyId) {
    return 'unavailable'
  }
  const queuedLaunchToken = state.pendingStartupByTabId?.[args.tabId]?.launchToken
  if (queuedLaunchToken !== undefined && queuedLaunchToken !== args.launchToken) {
    return 'conflict'
  }
  const paneKey = makePaneKey(args.tabId, hostPane.leafId)
  const existing = state.agentLaunchConfigByPaneKey?.[paneKey]
  if (existing) {
    return existing.identity.tabId === args.tabId &&
      existing.identity.leafId === hostPane.leafId &&
      existing.identity.launchToken === args.launchToken &&
      (!existing.identity.agentType || existing.identity.agentType === args.startup.agent)
      ? 'bound'
      : 'conflict'
  }
  // The Host resolved its own command/default args and env. Persist only the
  // semantic authority marker and permission choice; durable resume must not
  // mistake this Renderer's different defaults for the Host's launch config.
  state.registerAgentLaunchConfig(
    paneKey,
    {
      agentArgs: '',
      agentEnv: {},
      hostDefaultsAuthoritative: true,
      ...(args.startup.agentPermissionMode
        ? { agentPermissionMode: args.startup.agentPermissionMode }
        : {})
    },
    {
      agentType: args.startup.agent,
      launchToken: args.launchToken,
      tabId: args.tabId,
      leafId: hostPane.leafId
    }
  )
  const registered = useAppStore.getState().agentLaunchConfigByPaneKey?.[paneKey]
  return registered?.identity.launchToken === args.launchToken ? 'bound' : 'conflict'
}
