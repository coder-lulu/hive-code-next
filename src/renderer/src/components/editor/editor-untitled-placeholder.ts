import type { AppState } from '@/store'
import type { OpenFile } from '@/store/slices/editor'
import { findWorktreeById } from '@/store/slices/worktree-helpers'
import { getEditorFileOperationContext } from '@/lib/editor-file-operation-owner'
import { releaseRuntimeUntitledPlaceholder } from '@/runtime/runtime-untitled-placeholder-client'

export function releaseEditorUntitledPlaceholder(
  state: AppState,
  file: OpenFile | undefined
): void {
  if (!file?.untitledPlaceholderLeaseToken || file.mode !== 'edit') {
    return
  }
  const worktree = findWorktreeById(state.worktreesByRepo ?? {}, file.worktreeId)
  try {
    const context = getEditorFileOperationContext(state, file, worktree?.path ?? null)
    void releaseRuntimeUntitledPlaceholder(
      context,
      file.filePath,
      file.untitledPlaceholderLeaseToken
    ).catch((error) => console.warn('Failed to release untitled placeholder lease', error))
  } catch (error) {
    // A changed owner cannot release a lease on another host; its owning host lifetime drains it.
    console.warn('Untitled placeholder owner changed before lease release', error)
  }
}

type QueuedEditorPlaceholderRequest = {
  file: OpenFile
  leaseConsumed: boolean
}

function sameQueuedEditorFile(left: OpenFile, right: OpenFile): boolean {
  return (
    left.id === right.id &&
    left.filePath === right.filePath &&
    left.worktreeId === right.worktreeId &&
    left.runtimeEnvironmentId === right.runtimeEnvironmentId &&
    left.operationProvenance === right.operationProvenance
  )
}

// A preceding real save can consume a lease while another save of this tab is already queued.
export function createQueuedEditorUntitledPlaceholderRequests() {
  const requests = new Set<QueuedEditorPlaceholderRequest>()
  return {
    track(file: OpenFile): QueuedEditorPlaceholderRequest {
      const request = { file, leaseConsumed: false }
      requests.add(request)
      return request
    },
    assertCurrent(request: QueuedEditorPlaceholderRequest, liveFile: OpenFile): void {
      const tokenMatches =
        liveFile.untitledPlaceholderLeaseToken === request.file.untitledPlaceholderLeaseToken ||
        (request.leaseConsumed && liveFile.untitledPlaceholderLeaseToken === undefined)
      if (!sameQueuedEditorFile(request.file, liveFile) || !tokenMatches) {
        throw new Error('The queued editor file was replaced. Its edits were kept.')
      }
    },
    recordConsumption(before: OpenFile, after: OpenFile | undefined): void {
      const token = before.untitledPlaceholderLeaseToken
      if (
        !token ||
        !after ||
        after.untitledPlaceholderLeaseToken !== undefined ||
        !sameQueuedEditorFile(before, after)
      ) {
        return
      }
      for (const request of requests) {
        if (
          request.file.untitledPlaceholderLeaseToken === token &&
          sameQueuedEditorFile(request.file, before)
        ) {
          request.leaseConsumed = true
        }
      }
    },
    forget(request: QueuedEditorPlaceholderRequest): void {
      requests.delete(request)
    },
    clear(): void {
      requests.clear()
    }
  }
}
