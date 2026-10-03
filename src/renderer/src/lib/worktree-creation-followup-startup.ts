import type { WorktreeCreationRequest } from '@/lib/pending-worktree-creation'

type FollowupStartupRequest = Pick<WorktreeCreationRequest, 'startup' | 'startupPlan'>

export function prepareBackendFollowupStartup(
  request: FollowupStartupRequest,
  createLaunchToken: () => string
): void {
  if (
    !request.startup ||
    (!request.startupPlan?.followupPrompt && !request.startupPlan?.draftPrompt)
  ) {
    return
  }
  const launchToken = request.startupPlan.launchToken ?? createLaunchToken()
  request.startupPlan.launchToken = launchToken
  request.startup = { ...request.startup, launchToken }
}

export function needsPostCreateAgentStartup(
  request: Pick<WorktreeCreationRequest, 'startupPlan'>,
  backendSpawned: boolean
): boolean {
  return Boolean(
    request.startupPlan &&
    (!backendSpawned || request.startupPlan.followupPrompt || request.startupPlan.draftPrompt)
  )
}
