import { useCallback, useRef } from 'react'
import { useAppStore } from '@/store'
import { track } from '@/lib/telemetry'
import type { AddRepoExistingWorkspaceSource } from '../../../../shared/telemetry-events'
import {
  buildAddRepoExistingWorkspacesTelemetry,
  shouldTrackAddRepoExistingWorkspacesDetected
} from './add-repo-existing-workspaces-telemetry'
import { compareWorktreeDisplayName } from '@/lib/worktree-display-name-order'
import { finishProjectAddWithDefaultCheckout } from './project-added-default-checkout'
import type { ExecutionHostId } from '../../../../shared/execution-host'

type CompleteGitRepoAddOptions = {
  closeModal: () => void
  setHideDefaultBranchWorkspace: (hide: boolean) => void
  /**
   * Optional space captured by the scoped Add Project action.  Undefined is
   * intentionally different from null: null means the derived Ungrouped
   * space was selected explicitly.
   */
  projectGroupId?: string | null
  /** Why: the nested Add Project flow (hosted inside the workspace composer)
   *  keeps the composer open and selects the new project instead of running
   *  the default-checkout navigation handoff. Telemetry above still applies. */
  finishProjectAdd?: (
    repoId: string,
    source: AddRepoExistingWorkspaceSource,
    executionHostId?: ExecutionHostId
  ) => Promise<void>
}

export function useCompleteGitRepoAdd({
  closeModal,
  setHideDefaultBranchWorkspace,
  finishProjectAdd,
  projectGroupId
}: CompleteGitRepoAddOptions): (
  repoId: string,
  source: AddRepoExistingWorkspaceSource,
  executionHostId?: ExecutionHostId
) => Promise<void> {
  const detectedTelemetryTrackedRef = useRef<Set<string>>(new Set())

  return useCallback(
    async (
      repoId: string,
      source: AddRepoExistingWorkspaceSource,
      executionHostId?: ExecutionHostId
    ): Promise<void> => {
      const worktrees = (useAppStore.getState().worktreesByRepo[repoId] ?? []).filter(
        (worktree) =>
          executionHostId === undefined ||
          worktree.hostId === executionHostId ||
          (!worktree.hostId && executionHostId === 'local')
      )
      const sortedWorktrees = [...worktrees].sort((a, b) => {
        if (a.lastActivityAt !== b.lastActivityAt) {
          return b.lastActivityAt - a.lastActivityAt
        }
        return compareWorktreeDisplayName(a, b)
      })
      const existingWorkspaceTelemetry = buildAddRepoExistingWorkspacesTelemetry(
        source,
        sortedWorktrees
      )
      if (
        existingWorkspaceTelemetry &&
        shouldTrackAddRepoExistingWorkspacesDetected(existingWorkspaceTelemetry) &&
        !detectedTelemetryTrackedRef.current.has(repoId)
      ) {
        detectedTelemetryTrackedRef.current.add(repoId)
        track('add_repo_existing_workspaces_detected', existingWorkspaceTelemetry)
      }
      if (projectGroupId !== undefined) {
        const moved = await useAppStore.getState().moveProjectToGroup(repoId, projectGroupId)
        if (!moved) {
          // Adding a project succeeded even if a stale/remote catalog prevented
          // the follow-up association.  Keep the completion flow usable and
          // leave an actionable breadcrumb for diagnostics.
          console.warn('Failed to associate added project with its originating space', {
            repoId,
            projectGroupId
          })
        }
      }
      if (finishProjectAdd) {
        await finishProjectAdd(repoId, source, executionHostId)
        return
      }
      await finishProjectAddWithDefaultCheckout({
        repoId,
        source,
        executionHostId,
        closeModal,
        setHideDefaultBranchWorkspace
      })
    },
    [closeModal, finishProjectAdd, projectGroupId, setHideDefaultBranchWorkspace]
  )
}
