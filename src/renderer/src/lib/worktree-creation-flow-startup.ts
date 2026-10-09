import { useAppStore } from '@/store'
import { getActiveRuntimeTarget } from '@/runtime/runtime-rpc-client'
import { createBrowserUuid } from '@/lib/browser-uuid'
import type { WorktreeStartupPayload } from '@/lib/worktree-startup-payload'
import { toAgentLaunchPreferences } from '../../../shared/agent-launch-preferences'
import type { CreateWorktreeCallOptions } from '@/store/slices/worktrees/create/worktree-create-payload'
import type {
  WorktreeCreationPhase,
  WorktreeCreationRequest
} from '@/lib/pending-worktree-creation'

export function ensureWorktreeCreationLaunchToken(
  request: WorktreeCreationRequest,
  backendSpawned: boolean
): void {
  if (request.startupPlan && !backendSpawned && !request.startupPlan.launchToken) {
    // Why: delayed delivery must target the exact pane spawned from this queued
    // startup, so both halves of the handoff share one renderer-session token.
    request.startupPlan.launchToken = createBrowserUuid()
  }
}

export function buildWorktreeCreationHostOptions(
  request: WorktreeCreationRequest,
  backendStartup: WorktreeCreationRequest['startup'],
  structuredLaunch: boolean,
  provisionedRoot: CreateWorktreeCallOptions['provisionedRoot'] | null
): CreateWorktreeCallOptions {
  const startupLaunchPreferences = toAgentLaunchPreferences(request.startupPlan?.sessionOptions)
  return {
    executionHostId: request.workspaceRunContext?.hostId ?? request.executionHostId,
    ...(request.nameWasGenerated ? { nameWasGenerated: true } : {}),
    ...(request.displayNameKind ? { displayNameKind: request.displayNameKind } : {}),
    ...(request.linkedWorkItem !== undefined ? { linkedWorkItem: request.linkedWorkItem } : {}),
    ...(request.linkedTaskSourceContext !== undefined
      ? { linkedTaskSourceContext: request.linkedTaskSourceContext }
      : {}),
    // Why: the remote host must own task-draft startup so its initial terminal is the agent, not an idle fallback shell.
    ...(!structuredLaunch &&
    (!backendStartup || backendStartup.agentPermissionMode) &&
    request.agent &&
    request.launchDraftPrompt
      ? { startupDraft: request.launchDraftPrompt }
      : {}),
    ...(backendStartup?.agentPermissionMode && request.quickPrompt.trim()
      ? { startupPrompt: request.quickPrompt.trim() }
      : {}),
    ...(startupLaunchPreferences ? { startupLaunchPreferences } : {}),
    ...(request.startupPlan?.agentPermissionMode
      ? { requiresAgentLaunchPermissionCapability: true }
      : {}),
    ...(provisionedRoot ? { provisionedRoot } : {}),
    ...(request.parentWorktreeId ? { parentWorktreeId: request.parentWorktreeId } : {})
  }
}

// Why: mirrors the startup-opt the composer used to build inline. The renderer
// only seeds the first terminal when the backend did not already spawn it.
export function buildWorktreeCreationStartupOpt(
  request: WorktreeCreationRequest,
  backendSpawned: boolean
): WorktreeStartupPayload | undefined {
  const plan = request.startupPlan
  if (!plan || backendSpawned) {
    return undefined
  }
  return {
    command: plan.launchCommand,
    ...(plan.env ? { env: plan.env } : {}),
    launchConfig: plan.launchConfig,
    ...(plan.launchToken ? { launchToken: plan.launchToken } : {}),
    ...(request.agent ? { launchAgent: request.agent } : {}),
    ...(plan.agentPermissionMode ? { agentPermissionMode: plan.agentPermissionMode } : {}),
    ...(plan.draftPrompt ? { draftPrompt: plan.draftPrompt } : {}),
    // Why: view-mode only. An argv-prefill plan sets no draftPrompt, so this is
    // the sole signal that this launch starts with unsent context in the TUI.
    ...(request.launchDraftPrompt ? { launchDraftText: request.launchDraftPrompt } : {}),
    ...(plan.startupCommandDelivery ? { startupCommandDelivery: plan.startupCommandDelivery } : {}),
    // Why: command-code shows its prompt in the tab status before the first
    // hook fires, so the prompt is threaded through here.
    ...(request.agent === 'command-code' && request.quickPrompt.trim().length > 0
      ? { initialAgentStatus: { agent: request.agent, prompt: request.quickPrompt.trim() } }
      : {}),
    ...(request.quickTelemetry ? { telemetry: request.quickTelemetry } : {})
  }
}

export function getWorktreeCreationIndeterminate(request: WorktreeCreationRequest): boolean {
  if (request.worktreeCreateProgressMode) {
    return request.worktreeCreateProgressMode === 'indeterminate'
  }
  return getActiveRuntimeTarget(useAppStore.getState().settings).kind !== 'local'
}

export function getInitialWorktreeCreationPhase(
  request: WorktreeCreationRequest
): WorktreeCreationPhase {
  if (request.hookPreparation) {
    return 'preparing'
  }
  return request.ephemeralVmRecipe && !request.ephemeralVmRuntimeId ? 'provisioning-vm' : 'fetching'
}
