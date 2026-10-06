import {
  getOpenFilesForExternalFileChange,
  ORCA_EDITOR_EXTERNAL_FILE_CHANGE_EVENT,
  ORCA_EDITOR_QUIESCE_FILE_SAVES_EVENT,
  ORCA_EDITOR_SAVE_AND_CLOSE_EVENT,
  ORCA_EDITOR_SAVE_FILE_EVENT,
  type EditorSaveFileDetail,
  type EditorSaveQuiesceDetail
} from './editor-autosave'
import { flushPendingEditorChange } from './editor-pending-flush'
import { findWorktreeById } from '@/store/slices/worktree-helpers'
import {
  assertEditorFileOperationCurrent,
  captureEditorFileOperationProvenance,
  getEditorFileOperationContext
} from '@/lib/editor-file-operation-owner'
import {
  autosaveSubscriberInputsEqual,
  getAutosaveSubscriberInputs
} from './editor-autosave-state-projections'
import { createEditorSaveQueue, type AppStoreApi } from './editor-save-queue'
import { createEditorRestartSaveHandlers } from './editor-restart-save-handlers'
import { createEditorExternalChangeTabReset } from './editor-external-change-tab-reset'
import {
  ORCA_EDITOR_PREPARE_HOT_EXIT_EVENT,
  ORCA_EDITOR_SAVE_DIRTY_FILES_EVENT
} from '../../../../shared/editor-save-events'

export function attachEditorAutosaveController(store: AppStoreApi): () => void {
  const saveQueue = createEditorSaveQueue(store)
  const { queueSave, quiesceFileSave, clearAutoSaveTimer, bumpSaveGeneration, syncAutoSave } =
    saveQueue

  const { handleSaveDirtyFiles, handlePrepareHotExit } = createEditorRestartSaveHandlers({
    store,
    queueSave,
    quiesceFileSave
  })

  const handleExternalFileChange = createEditorExternalChangeTabReset({
    store,
    clearAutoSaveTimer,
    bumpSaveGeneration
  })

  const handleSaveAndClose = async (event: Event): Promise<void> => {
    const { fileId } = (event as CustomEvent<{ fileId: string }>).detail
    const initial = store.getState()
    const file = initial.openFiles.find((openFile) => openFile.id === fileId)
    if (!file) {
      return
    }

    let operationProvenance: ReturnType<typeof captureEditorFileOperationProvenance>
    let originalContext: ReturnType<typeof getEditorFileOperationContext>
    try {
      operationProvenance =
        file.operationProvenance ??
        captureEditorFileOperationProvenance(
          initial,
          file.worktreeId,
          file.runtimeEnvironmentId,
          file.runtimeEnvironmentId !== undefined
        )
      const worktree = findWorktreeById(initial.worktreesByRepo ?? {}, file.worktreeId)
      originalContext = getEditorFileOperationContext(
        initial,
        { ...file, operationProvenance },
        worktree?.path ?? null
      )
      flushPendingEditorChange(file.id)
      assertEditorFileOperationCurrent(store.getState(), file.worktreeId, operationProvenance)
    } catch {
      return
    }
    const draft = store.getState().editorDrafts[fileId]
    if (draft !== undefined) {
      try {
        await queueSave(file, draft)
      } catch {
        return
      }
    }
    const current = store.getState()
    const currentFile = current.openFiles.find((entry) => entry.id === fileId)
    if (
      !currentFile ||
      currentFile.filePath !== file.filePath ||
      currentFile.operationProvenance !== file.operationProvenance ||
      currentFile.worktreeId !== file.worktreeId ||
      currentFile.pendingOwnerMigration === true ||
      currentFile.isDirty ||
      current.editorDrafts[fileId] !== undefined ||
      (currentFile.untitledPlaceholderLeaseToken !== undefined &&
        currentFile.untitledPlaceholderLeaseToken !== file.untitledPlaceholderLeaseToken)
    ) {
      return
    }
    try {
      const worktree = findWorktreeById(current.worktreesByRepo ?? {}, currentFile.worktreeId)
      const currentContext = getEditorFileOperationContext(
        current,
        { ...currentFile, operationProvenance },
        worktree?.path ?? null
      )
      if (
        currentContext.worktreePath !== originalContext.worktreePath ||
        currentContext.connectionId !== originalContext.connectionId ||
        currentContext.expectedExecutionHostId !== originalContext.expectedExecutionHostId ||
        currentContext.expectedSshTargetId !== originalContext.expectedSshTargetId ||
        currentContext.expectedSshConnectionGeneration !==
          originalContext.expectedSshConnectionGeneration ||
        currentContext.settings?.activeRuntimeEnvironmentId !==
          originalContext.settings?.activeRuntimeEnvironmentId
      ) {
        return
      }
    } catch {
      return
    }
    current.closeFile(fileId)
  }

  const handleSaveFile = async (event: Event): Promise<void> => {
    const detail = (event as CustomEvent<EditorSaveFileDetail>).detail
    if (!detail) {
      return
    }

    try {
      detail.claim()
      const file = store.getState().openFiles.find((openFile) => openFile.id === detail.fileId)
      if (!file) {
        detail.resolve()
        return
      }
      if (file.pendingOwnerMigration === true) {
        detail.reject('This file is still restoring its workspace owner. Try saving again.')
        return
      }

      flushPendingEditorChange(file.id)

      const content = store.getState().editorDrafts[file.id] ?? detail.fallbackContent
      if (content === undefined) {
        detail.resolve()
        return
      }

      await queueSave(file, content)
      detail.resolve()
    } catch (error) {
      detail.reject(String((error as Error)?.message ?? error))
    }
  }

  const handleQuiesce = async (event: Event): Promise<void> => {
    const detail = (event as CustomEvent<EditorSaveQuiesceDetail>).detail
    if (!detail) {
      return
    }
    detail.claim()

    const matchingFiles =
      'fileId' in detail
        ? store.getState().openFiles.filter((file) => file.id === detail.fileId)
        : getOpenFilesForExternalFileChange(store.getState().openFiles, detail)

    try {
      await Promise.all(matchingFiles.map((file) => quiesceFileSave(file.id)))
      detail.resolve()
    } catch (error) {
      detail.reject(error instanceof Error ? error.message : String(error))
    }
  }

  // Why: the root subscriber fires on every store tick; skip the scan unless the four autosave inputs changed.
  let previousAutosaveInputs = getAutosaveSubscriberInputs(store.getState())
  const unsubscribe = store.subscribe(() => {
    const nextAutosaveInputs = getAutosaveSubscriberInputs(store.getState())
    if (autosaveSubscriberInputsEqual(previousAutosaveInputs, nextAutosaveInputs)) {
      return
    }
    previousAutosaveInputs = nextAutosaveInputs
    syncAutoSave()
  })
  syncAutoSave()

  window.addEventListener(ORCA_EDITOR_SAVE_DIRTY_FILES_EVENT, handleSaveDirtyFiles as EventListener)
  window.addEventListener(ORCA_EDITOR_PREPARE_HOT_EXIT_EVENT, handlePrepareHotExit as EventListener)
  window.addEventListener(ORCA_EDITOR_SAVE_AND_CLOSE_EVENT, handleSaveAndClose as EventListener)
  window.addEventListener(ORCA_EDITOR_SAVE_FILE_EVENT, handleSaveFile as EventListener)
  window.addEventListener(ORCA_EDITOR_QUIESCE_FILE_SAVES_EVENT, handleQuiesce as EventListener)
  window.addEventListener(
    ORCA_EDITOR_EXTERNAL_FILE_CHANGE_EVENT,
    handleExternalFileChange as EventListener
  )

  return () => {
    unsubscribe()
    window.removeEventListener(
      ORCA_EDITOR_SAVE_DIRTY_FILES_EVENT,
      handleSaveDirtyFiles as EventListener
    )
    window.removeEventListener(
      ORCA_EDITOR_PREPARE_HOT_EXIT_EVENT,
      handlePrepareHotExit as EventListener
    )
    window.removeEventListener(
      ORCA_EDITOR_SAVE_AND_CLOSE_EVENT,
      handleSaveAndClose as EventListener
    )
    window.removeEventListener(ORCA_EDITOR_SAVE_FILE_EVENT, handleSaveFile as EventListener)
    window.removeEventListener(ORCA_EDITOR_QUIESCE_FILE_SAVES_EVENT, handleQuiesce as EventListener)
    window.removeEventListener(
      ORCA_EDITOR_EXTERNAL_FILE_CHANGE_EVENT,
      handleExternalFileChange as EventListener
    )
    saveQueue.dispose()
  }
}
