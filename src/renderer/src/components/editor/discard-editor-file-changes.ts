import { useAppStore } from '@/store'
import { requestEditorSaveQuiesce } from './editor-autosave'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { findWorktreeById } from '@/store/slices/worktree-helpers'
import { getEditorFileOperationContext } from '@/lib/editor-file-operation-owner'
import { discardRuntimeUntitledPlaceholder } from '@/runtime/runtime-untitled-placeholder-client'
import { getDiskBaselineSignature } from './diff-content-signature'

/** "Don't Save": cancel pending saves, drop unsaved edits, then close the tab. */
export async function discardEditorFileChangesAndClose(fileId: string): Promise<void> {
  try {
    await discardCurrentEditorFileChangesAndClose(fileId)
  } catch (error) {
    toast.error(
      translate(
        'auto.components.editor.untitledDiscardFailed',
        'Could not discard this file. Its edits were kept.'
      ),
      { description: error instanceof Error ? error.message : String(error) }
    )
    throw error
  }
}

async function discardCurrentEditorFileChangesAndClose(fileId: string): Promise<void> {
  // Why: "Don't Save" must win over any pending autosave write for the same tab.
  await requestEditorSaveQuiesce({ fileId })
  const state = useAppStore.getState()
  const file = state.openFiles.find((openFile) => openFile.id === fileId)
  if (!file) {
    return
  }
  const worktree = findWorktreeById(state.worktreesByRepo ?? {}, file.worktreeId)
  const context = getEditorFileOperationContext(state, file, worktree?.path ?? null)
  let removedPlaceholder = false
  if (
    file.isUntitled &&
    file.deleteUntouchedOnClose !== false &&
    (file.lastKnownDiskSignature === undefined ||
      file.lastKnownDiskSignature === getDiskBaselineSignature(''))
  ) {
    if (file.untitledPlaceholderLeaseToken) {
      const result = await discardRuntimeUntitledPlaceholder(
        context,
        file.filePath,
        file.untitledPlaceholderLeaseToken
      )
      removedPlaceholder = result.status === 'removed-placeholder'
      if (result.status === 'recovery-required') {
        toast.error(
          translate(
            'auto.components.editor.untitledPlaceholderRecovery',
            'The file was retained for recovery. Recover it from {{path}}.',
            { path: result.recovery.retainedPath }
          )
        )
        throw new Error(`File retained for recovery: ${result.recovery.retainedPath}`)
      }
      if (result.status === 'unavailable') {
        if (result.reason !== 'host-capability-unavailable') {
          throw new Error(
            'The file creation lease is no longer valid. Reopen the file before discarding.'
          )
        }
        toast.warning(
          translate(
            'auto.components.editor.untitledPlaceholderPreserved',
            'This host cannot safely remove the blank file. The file was preserved.'
          )
        )
      }
    } else {
      toast.warning(
        translate(
          'auto.components.editor.untitledPlaceholderPreserved',
          'This host cannot safely remove the blank file. The file was preserved.'
        )
      )
    }
  }
  // Watcher echoes may mark the captured path deleted; they cannot authorize new edits or owners.
  const current = useAppStore.getState()
  const currentFile = current.openFiles.find((openFile) => openFile.id === fileId)
  if (
    !currentFile ||
    currentFile.filePath !== file.filePath ||
    currentFile.operationProvenance !== file.operationProvenance ||
    currentFile.worktreeId !== file.worktreeId ||
    currentFile.pendingOwnerMigration === true ||
    currentFile.untitledPlaceholderLeaseToken !== file.untitledPlaceholderLeaseToken ||
    current.editorDrafts[fileId] !== state.editorDrafts[fileId]
  ) {
    throw new Error('The editor file changed while discarding. Review it before closing.')
  }
  const currentWorktree = findWorktreeById(current.worktreesByRepo ?? {}, currentFile.worktreeId)
  const currentContext = getEditorFileOperationContext(
    current,
    currentFile,
    currentWorktree?.path ?? null
  )
  if (
    currentContext.worktreePath !== context.worktreePath ||
    currentContext.connectionId !== context.connectionId ||
    currentContext.expectedExecutionHostId !== context.expectedExecutionHostId ||
    currentContext.expectedSshTargetId !== context.expectedSshTargetId ||
    currentContext.expectedSshConnectionGeneration !== context.expectedSshConnectionGeneration ||
    currentContext.settings?.activeRuntimeEnvironmentId !==
      context.settings?.activeRuntimeEnvironmentId
  ) {
    throw new Error('The file owner changed while discarding. Its edits were kept.')
  }
  state.markFileDirty(fileId, false)
  // Why: a leftover draft makes closeFile keep a never-saved untitled placeholder on disk.
  state.clearEditorDraft(fileId)
  state.closeFile(fileId, { excludeFromRecentlyClosed: removedPlaceholder })
}
