import { useAppStore } from '@/store'
import { returnCreatedWorkspaceToSessions } from '@/lib/workspace-creation-session-return'
import { needsPostCreateAgentStartup } from '@/lib/worktree-creation-followup-startup'
import { ensureAgentStartupInTerminal } from '@/lib/new-workspace'
import { queueWorkspaceActivationTerminalFocus } from '@/lib/workspace-activation-terminal-focus'
import { seedAgentTabStateAfterWorktreeCreate } from '@/lib/worktree-creation-agent-seeds'
import type { ActivateAndRevealResult } from '@/lib/worktree-activation'
import type { WorktreeCreationRequest } from '@/lib/pending-worktree-creation'

export async function completeWorktreeCreation(args: {
  creationId: string
  request: WorktreeCreationRequest
  worktreeId: string
  structuredLaunchAccepted: boolean
  activation: ActivateAndRevealResult | false
  primaryTabId: string | null
  startupTerminalTabId?: string
  startupPaneKey?: string | null
  backendSpawned: boolean
  focusOnCompletion: boolean
}): Promise<void> {
  const { request } = args
  const returnToSessions =
    useAppStore.getState().pendingWorktreeCreations[args.creationId]?.returnToSessions === true
  // Why: clearing synchronously after activation lets React commit the panel-to-terminal swap in one frame.
  useAppStore.getState().removePendingWorktreeCreation(args.creationId, { cleanupVm: false })
  if (!args.structuredLaunchAccepted) {
    seedAgentTabStateAfterWorktreeCreate({
      request,
      worktreeId: args.worktreeId,
      primaryTabId: args.primaryTabId,
      startupTerminalTabId: args.startupTerminalTabId,
      backendSpawned: args.backendSpawned
    })
  }
  if (
    !args.structuredLaunchAccepted &&
    request.startupPlan &&
    needsPostCreateAgentStartup(request, args.backendSpawned)
  ) {
    void ensureAgentStartupInTerminal({
      worktreeId: args.worktreeId,
      primaryTabId:
        args.backendSpawned && args.startupTerminalTabId
          ? args.startupTerminalTabId
          : args.primaryTabId,
      ...(args.backendSpawned && args.startupPaneKey
        ? { startupPaneKey: args.startupPaneKey }
        : {}),
      startup: request.startupPlan
    })
  }
  if (
    !args.structuredLaunchAccepted &&
    !request.suppressTerminalFocusOnCompletion &&
    args.focusOnCompletion
  ) {
    queueWorkspaceActivationTerminalFocus(args.worktreeId, args.activation)
  }

  if (returnToSessions && args.focusOnCompletion) {
    returnCreatedWorkspaceToSessions(args.worktreeId)
  }

  // Why: note persistence is cosmetic and should not delay the visible workspace handoff.
  if (request.note) {
    try {
      await useAppStore.getState().updateWorktreeMeta(args.worktreeId, { comment: request.note })
    } catch {
      console.error('Failed to update worktree meta after creation')
    }
  }
}
