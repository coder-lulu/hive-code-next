import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppState } from '@/store'
import type { StoreApi } from 'zustand/vanilla'
import {
  createFakeEditorDisk,
  createUntitledNoteStore,
  stubEditorWindowWithDisk,
  type FakeEditorDisk
} from './editor-autosave-controller-test-fixture'

vi.mock('@/lib/connection-context', () => ({ getConnectionIdForFile: vi.fn() }))
const original = '/repo/untitled.md'
const destination = '/repo/named.md'
const rekey = {
  oldFileId: original,
  oldFilePath: original,
  newFileId: destination,
  newFilePath: destination,
  newRelativePath: 'named.md',
  consumeUntitled: true
}

describe('untitled placeholder leases during editor path changes', () => {
  let disk: FakeEditorDisk
  let store: StoreApi<AppState>
  beforeEach(() => {
    disk = stubEditorWindowWithDisk(createFakeEditorDisk({ [original]: '' }))
    store = createUntitledNoteStore('untitled.md')
    store.getState().setEditorDraft(original, 'unsaved draft')
    store.getState().markFileDirty(original, true)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('releases the exact original lease after a successful rename and keeps its draft', async () => {
    const result = store.getState().rekeyOpenFilesForPathChange({ rekeys: [rekey] })
    expect(result).toEqual({ ok: true })
    await Promise.resolve()
    expect(disk.fs.releaseUntitledPlaceholder).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: original,
        leaseToken: `fixture-origin:${original}`,
        expectedExecutionHostId: 'local'
      })
    )
    expect(disk.fs.releaseUntitledPlaceholder).toHaveBeenCalledTimes(1)
    expect(store.getState().openFiles[0]?.untitledPlaceholderLeaseToken).toBeUndefined()
    expect(store.getState().openFiles[0]?.isUntitled).toBeUndefined()
    expect(store.getState().openFiles[0]?.isDirty).toBe(true)
    expect(store.getState().editorDrafts[destination]).toBe('unsaved draft')
    expect(disk.files.get(original)).toBe('')
    expect(disk.fs.deletePath).not.toHaveBeenCalled()
  })

  it('keeps the lease and both tabs when the rename collides with an open tab', async () => {
    store.getState().openFile({
      filePath: destination,
      relativePath: 'named.md',
      worktreeId: 'wt-1',
      language: 'markdown',
      mode: 'edit'
    })
    const result = store.getState().rekeyOpenFilesForPathChange({ rekeys: [rekey] })
    expect(result).toEqual({ ok: false, reason: 'collision' })
    await Promise.resolve()
    expect(disk.fs.releaseUntitledPlaceholder).not.toHaveBeenCalled()
    expect(store.getState().openFiles).toHaveLength(2)
    expect(
      store.getState().openFiles.find((file) => file.id === original)?.untitledPlaceholderLeaseToken
    ).toBe(`fixture-origin:${original}`)
    expect(store.getState().editorDrafts[original]).toBe('unsaved draft')
    expect(disk.files.get(original)).toBe('')
  })

  it('keeps the lease when another source disappears before an atomic batch rename', async () => {
    const result = store.getState().rekeyOpenFilesForPathChange({
      rekeys: [
        rekey,
        {
          oldFileId: '/repo/gone.md',
          oldFilePath: '/repo/gone.md',
          newFileId: '/repo/other.md',
          newFilePath: '/repo/other.md',
          newRelativePath: 'other.md'
        }
      ]
    })
    expect(result).toEqual({ ok: false, reason: 'stale' })
    await Promise.resolve()
    expect(disk.fs.releaseUntitledPlaceholder).not.toHaveBeenCalled()
    expect(store.getState().openFiles[0]?.id).toBe(original)
    expect(store.getState().openFiles[0]?.untitledPlaceholderLeaseToken).toBe(
      `fixture-origin:${original}`
    )
    expect(store.getState().editorDrafts[original]).toBe('unsaved draft')
  })
})
