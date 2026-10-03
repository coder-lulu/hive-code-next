import {
  activateAndRevealFolderWorkspace,
  activateAndRevealWorktree
} from '@/lib/worktree-activation'
import { parseWorkspaceKey } from '../../../shared/workspace-scope'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import type { ExecutionHostId } from '../../../shared/execution-host'

export async function activateWorktreeFromSidebar(
  worktreeId: string,
  executionHostId?: ExecutionHostId,
  onActivated?: () => void
): Promise<void> {
  const workspaceScope = parseWorkspaceKey(worktreeId)
  if (workspaceScope?.type === 'folder') {
    const result = executionHostId
      ? activateAndRevealFolderWorkspace(workspaceScope.folderWorkspaceId, {
          executionHostId,
          navigationIntent: 'user-open'
        })
      : activateAndRevealFolderWorkspace(workspaceScope.folderWorkspaceId, {
          navigationIntent: 'user-open'
        })
    if (result) {
      onActivated?.()
    }
    return
  }
  // Keep navigation independent from an optional runtime wake IPC.
  const result = activateAndRevealWorktree(worktreeId, {
    navigationIntent: 'user-open',
    revealInSidebar: false,
    ...(executionHostId ? { executionHostId } : {})
  })

  if (result) {
    onActivated?.()
  }

  if (typeof window !== 'undefined' && window.api?.ephemeralVm?.resumeWorkspace) {
    try {
      const runtime = await window.api.ephemeralVm.resumeWorkspace({ workspaceId: worktreeId })
      if (runtime?.runtimeEnvironmentId) {
        const store = (await import('@/store')).useAppStore
        store.getState().setRuntimeEnvironments(await window.api.runtimeEnvironments.list())
        await store.getState().refreshRuntimeEnvironmentStatus(runtime.runtimeEnvironmentId)
      }
    } catch (error) {
      toast.error(
        translate(
          'auto.lib.sidebarWorktreeActivation.wakeEphemeralVmFailed',
          'Failed to wake ephemeral VM workspace'
        ),
        {
          description: error instanceof Error ? error.message : String(error)
        }
      )
    }
  }
}
