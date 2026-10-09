// @vitest-environment happy-dom

import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../shared/constants'
import type * as EditorAutosaveModule from './editor/editor-autosave'
import type * as EditorDiscardModule from './editor/discard-editor-file-changes'

type FakeOpenFile = {
  id: string
  worktreeId: string
  isDirty: boolean
  relativePath: string
  filePath: string
}
const store = vi.hoisted(
  (): {
    openFiles: FakeOpenFile[]
    activeWorktreeId: string | null
    editorDrafts: Record<string, string>
  } => ({ openFiles: [], activeWorktreeId: 'wt-main', editorDrafts: {} })
)
const revealFloatingWorkspacePanel = vi.hoisted(() => vi.fn())
const discardFile = vi.hoisted(() => vi.fn())

vi.mock('../store', () => ({
  useAppStore: {
    // "Don't Save" closes through the store, beside the controller's own projection.
    getState: () => ({
      ...store,
      repos: [],
      worktreesByRepo: {},
      detectedWorktreesByRepo: {},
      folderWorkspaces: [],
      projectGroups: [],
      runtimeEnvironments: [],
      runtimeEnvironmentCatalogHydrated: true,
      removedRuntimeEnvironmentIds: [],
      restoredRuntimeHostIdByWorkspaceSessionKey: {},
      sshConnectionStates: {},
      sshStateByEnvironment: {},
      settings: {},
      activeWorkspaceExecutionHostId: null,
      markFileDirty: (fileId: string, dirty: boolean) => {
        const file = store.openFiles.find((item) => item.id === fileId)
        if (file) {
          file.isDirty = dirty
        }
      },
      clearEditorDraft: (fileId: string) => {
        delete store.editorDrafts[fileId]
      },
      closeFile
    }),
    subscribe: () => () => {}
  }
}))
vi.mock('@/lib/floating-workspace-panel-reveal', () => ({ revealFloatingWorkspacePanel }))
vi.mock('./terminal/window-close-running-work', () => ({ assessWindowCloseRunningWork: vi.fn() }))
vi.mock('./window-close-request-coordinator', () => ({
  runWithWindowCloseCheckpointScope: (fn: () => unknown) => fn()
}))
vi.mock('@/lib/shutdown-checkpoint-failure-toast', () => ({
  showShutdownCheckpointFailureToast: vi.fn()
}))
vi.mock('./editor/editor-autosave', async (importActual) => ({
  ...(await importActual<typeof EditorAutosaveModule>()),
  requestEditorSaveQuiesce: vi.fn(async () => {})
}))

vi.mock('./editor/discard-editor-file-changes', async (importActual) => {
  const actual = await importActual<typeof EditorDiscardModule>()
  discardFile.mockImplementation(actual.discardEditorFileChangesAndClose)
  return { ...actual, discardEditorFileChangesAndClose: discardFile }
})

const { useTerminalEditorCloseFoundation } = await import('./use-terminal-editor-close-foundation')
const { useTerminalEditorCloseQueue } = await import('./use-terminal-editor-close-queue')
const { useTerminalEditorCloseDialogActions } =
  await import('./use-terminal-editor-close-dialog-actions')
const { requestEditorFileClose, requestEditorSaveQuiesce } =
  await import('./editor/editor-autosave')

const setActiveWorktree = vi.fn()
const setActiveFile = vi.fn()
const setActiveTabType = vi.fn()
const closeFile = vi.fn((fileId: string) => {
  store.openFiles = store.openFiles.filter((file) => file.id !== fileId)
})

type Base = Parameters<typeof useTerminalEditorCloseFoundation>[0]

function mountCloseQueue() {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the close hooks read only these projection fields; the rest of the workspace projection is unused here.
  const base = {
    activeWorktreeId: store.activeWorktreeId,
    openFiles: store.openFiles,
    closeFile,
    markFileDirty: vi.fn(),
    setActiveFile,
    setActiveTabType,
    setActiveWorktree
  } as unknown as Base
  return renderHook(() => {
    const foundation = Object.assign({ ...base }, useTerminalEditorCloseFoundation(base))
    const queue = Object.assign(foundation, useTerminalEditorCloseQueue(foundation))
    return Object.assign(queue, useTerminalEditorCloseDialogActions(queue))
  })
}

function dirtyFile(id: string, worktreeId: string): FakeOpenFile {
  return { id, worktreeId, isDirty: true, relativePath: `${id}.md`, filePath: `/fixture/${id}.md` }
}

// The unsaved-changes prompt shows the file where it lives. The floating panel sits beside the main
// window and is never its active worktree, so revealing a floating note must not take it over.
describe('unsaved-changes prompt for a closing file', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    store.activeWorktreeId = 'wt-main'
    store.editorDrafts = {}
  })
  afterEach(() => cleanup())

  it('reveals a floating note in the floating panel without moving the main window', () => {
    store.openFiles = [dirtyFile('note', FLOATING_TERMINAL_WORKTREE_ID)]
    const { result } = mountCloseQueue()

    act(() => requestEditorFileClose('note'))

    expect(result.current.saveDialogFileId).toBe('note')
    expect(revealFloatingWorkspacePanel).toHaveBeenCalledOnce()
    expect(setActiveWorktree).not.toHaveBeenCalled()
    expect(setActiveTabType).toHaveBeenCalledWith('editor', FLOATING_TERMINAL_WORKTREE_ID)
  })

  it('still switches to a background worktree to show its file', () => {
    store.openFiles = [dirtyFile('readme', 'wt-other')]
    mountCloseQueue()

    act(() => requestEditorFileClose('readme'))

    expect(setActiveWorktree).toHaveBeenCalledWith('wt-other')
    expect(revealFloatingWorkspacePanel).not.toHaveBeenCalled()
  })

  it('runs the close reaction once the file is discarded', async () => {
    store.openFiles = [dirtyFile('note', FLOATING_TERMINAL_WORKTREE_ID)]
    const onClosed = vi.fn()
    const { result } = mountCloseQueue()
    act(() => requestEditorFileClose('note', { onClosed }))

    await act(() => result.current.handleSaveDialogDiscard())

    expect(closeFile).toHaveBeenCalledWith('note', { excludeFromRecentlyClosed: false })
    expect(onClosed).toHaveBeenCalledOnce()
  })

  it('does not discard a document reopened with a new draft after the first close', async () => {
    const original = dirtyFile('note', FLOATING_TERMINAL_WORKTREE_ID)
    const reopened = {
      ...original,
      filePath: '/fixture/reopened-note.md',
      relativePath: 'reopened-note.md'
    }
    store.openFiles = [original]
    store.editorDrafts = { note: 'the original unsaved edits' }
    closeFile.mockImplementationOnce(() => {
      // A close subscriber can synchronously open a new document epoch under the same renderer ID.
      store.openFiles = [reopened]
      store.editorDrafts = { note: 'the new document draft' }
    })
    const onClosed = vi.fn()
    const { result } = mountCloseQueue()
    act(() => requestEditorFileClose('note', { onClosed }))

    await act(() => result.current.handleSaveDialogDiscard())

    expect(discardFile).toHaveBeenCalledExactlyOnceWith('note')
    expect(requestEditorSaveQuiesce).toHaveBeenCalledExactlyOnceWith({ fileId: 'note' })
    expect(closeFile).toHaveBeenCalledExactlyOnceWith('note', { excludeFromRecentlyClosed: false })
    expect(onClosed).toHaveBeenCalledOnce()
    expect(store.openFiles).toEqual([reopened])
    expect(store.editorDrafts.note).toBe('the new document draft')
  })

  // Why a later close of the same file: a cancelled reaction left behind would fire on it.
  it('drops the close reaction when the prompt is cancelled', async () => {
    vi.useFakeTimers()
    store.openFiles = [dirtyFile('note', FLOATING_TERMINAL_WORKTREE_ID)]
    const onClosed = vi.fn()
    const { result } = mountCloseQueue()
    act(() => requestEditorFileClose('note', { onClosed }))
    act(() => result.current.handleSaveDialogCancel())
    act(() => vi.runAllTimers())

    act(() => requestEditorFileClose('note'))
    await act(() => result.current.handleSaveDialogDiscard())

    expect(closeFile).toHaveBeenCalledWith('note', { excludeFromRecentlyClosed: false })
    expect(onClosed).not.toHaveBeenCalled()
    vi.useRealTimers()
  })
})
