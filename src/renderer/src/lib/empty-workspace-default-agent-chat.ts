import { isNativeChatDefaultFor } from '../../../shared/structured-native-chat-launch-route'
import { pickTuiAgent, TUI_AGENT_AUTO_PICK_ORDER } from '../../../shared/tui-agent-selection'
import { withTimeout } from '../../../shared/promise-timeout-fallback'
import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import {
  getAgentDetectionTargetKeyForWorktree,
  parseAgentDetectionTargetKey
} from '@/hooks/useAgentDetectionTarget'
import type { AgentDetectionTarget } from '@/hooks/useDetectedAgents'
import {
  ensureDetectedAgentsForTarget,
  readDetectedAgentsForTarget
} from '@/lib/agent-detection-target-inventory'
import { workspaceKindForWorktreeId } from '@/lib/agent-launch-route-input'
import { planAgentSessionLaunch } from '@/lib/agent-session-launch-plan'
import { newAgentLaunchRequestId } from '@/lib/agent-launch-request-id'
import { launchAgentInNewTab } from '@/lib/launch-agent-in-new-tab'

// Why bounded: detection only decides chat vs shell, so a slow host must not hold the workspace empty.
const DEFAULT_CHAT_DETECTION_TIMEOUT_MS = 5_000

/**
 * The host whose agent list picks the default chat; undefined when the workspace opens a shell
 * whatever that list says. Shared by the wait and the open so they cannot drift.
 */
function defaultChatDetectionTarget(
  state: AppState,
  worktreeId: string
): AgentDetectionTarget | undefined {
  // Why: a 'blank' default means the user wants workspaces to open without an agent.
  const settings = state.settings
  if (!settings || settings.defaultTuiAgent === 'blank') {
    return undefined
  }
  // Why: an unresolved owner is an unknown host, not the local machine.
  const target = parseAgentDetectionTargetKey(
    getAgentDetectionTargetKeyForWorktree(state, worktreeId)
  )
  if (!target) return undefined
  const detected = readDetectedAgentsForTarget(state, target)
  const agent =
    detected === null
      ? settings.defaultTuiAgent
      : pickTuiAgent(settings.defaultTuiAgent, detected, settings.disabledTuiAgents)
  const couldDefaultToChat = agent
    ? isNativeChatDefaultFor(settings, agent)
    : detected === null &&
      TUI_AGENT_AUTO_PICK_ORDER.some(
        (candidate) =>
          !settings.disabledTuiAgents?.includes(candidate) &&
          isNativeChatDefaultFor(settings, candidate)
      )
  return couldDefaultToChat ? target : undefined
}

/** True when the default chat could open here but the workspace host's agent list has not loaded. */
export function emptyWorkspaceDefaultChatAwaitsDetection(worktreeId: string): boolean {
  const state = useAppStore.getState()
  const target = defaultChatDetectionTarget(state, worktreeId)
  return target !== undefined && readDetectedAgentsForTarget(state, target) === null
}

/** Loads the workspace host's agent list; resolves on success, failure, or timeout. */
export async function loadEmptyWorkspaceDefaultChatDetection(worktreeId: string): Promise<void> {
  const state = useAppStore.getState()
  const target = defaultChatDetectionTarget(state, worktreeId)
  if (!target) {
    return
  }
  await withTimeout(
    ensureDetectedAgentsForTarget(state, target),
    DEFAULT_CHAT_DETECTION_TIMEOUT_MS,
    []
  )
}

/**
 * When the user's new agent tabs open as chat, an empty workspace opens their default agent as a
 * chat instead of a bare shell. Null means nothing opened and the caller seeds the shell; so does
 * `seedShell` when the host declines the chat, since nobody asked for the agent's terminal.
 */
export function openDefaultAgentChatInEmptyWorkspace(
  worktreeId: string,
  seedShell: () => boolean
): { primaryTabId: string | null } | null {
  const state = useAppStore.getState()
  const target = defaultChatDetectionTarget(state, worktreeId)
  if (!target) {
    return null
  }
  const agent = pickTuiAgent(
    state.settings?.defaultTuiAgent,
    readDetectedAgentsForTarget(state, target) ?? [],
    state.settings?.disabledTuiAgents
  )
  if (!agent || !state.settings || !isNativeChatDefaultFor(state.settings, agent)) {
    return null
  }
  // No user gesture: opening this empty workspace is the one action this chat serves.
  const agentSessionLaunchPlan = planAgentSessionLaunch(state, {
    requestId: newAgentLaunchRequestId(),
    agent,
    workspace: { kind: workspaceKindForWorktreeId(worktreeId), worktreeId }
  })
  // Why: an agent that can only open as a TUI here would replace the shell with a process nobody asked for.
  if (agentSessionLaunchPlan.route === 'terminal-tui') {
    return null
  }
  const result = launchAgentInNewTab({
    agent,
    worktreeId,
    launchSource: 'unknown',
    agentSessionLaunchPlan,
    pendingActivationSpawn: true,
    onStructuredHostDeclined: () => ({ opened: seedShell() })
  })
  if (!result) {
    return null
  }
  return { primaryTabId: result.surface.kind === 'host-published' ? null : result.surface.tabId }
}
