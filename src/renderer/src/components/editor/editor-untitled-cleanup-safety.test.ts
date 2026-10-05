import { mkdtemp, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFakeEditorDisk,
  createUntitledNoteStore,
  stubEditorWindowWithDisk
} from './editor-autosave-controller-test-fixture'
import { deleteRuntimePath } from '@/runtime/runtime-file-client'

const FILE_ID = '/repo/untitled.md'

describe('untitled automatic cleanup without an atomic delete capability', () => {
  let directory: string
  let filePath: string
  let disk: ReturnType<typeof createFakeEditorDisk>
  let deletionOperations: Promise<void>[]

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'untitled-cleanup-'))
    filePath = join(directory, 'untitled.md')
    await writeFile(filePath, '')
    deletionOperations = []
    disk = createFakeEditorDisk()
    disk.fs.stat.mockImplementation(async ({ filePath: requestedPath }) => {
      expect(requestedPath).toBe(FILE_ID)
      const observed = await stat(filePath)
      return {
        size: observed.size,
        isDirectory: observed.isDirectory(),
        mtime: observed.mtimeMs
      }
    })
    disk.fs.deletePath.mockImplementation(({ targetPath }) => {
      expect(targetPath).toBe(FILE_ID)
      const operation = rm(filePath)
      deletionOperations.push(operation)
      return operation
    })
    stubEditorWindowWithDisk(disk)
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    await rm(directory, { recursive: true, force: true })
  })

  describe.each(['closeFile', 'closeAllFiles', 'closeAllFiles without a selection'] as const)(
    '%s',
    (closeMethod) => {
      it.each(['late write', 'replacement', 'directory', 'nonempty', 'empty'] as const)(
        'preserves a real %s file and its reopen entry',
        async (change) => {
          const original = await stat(filePath)
          const observed = {
            size: original.size,
            isDirectory: original.isDirectory(),
            mtime: original.mtimeMs
          }
          // The transport can deliver an empty observation after a writer or replacement has won.
          disk.fs.stat.mockResolvedValueOnce(observed)
          disk.fs.stat.mockClear()
          if (change === 'late write' || change === 'nonempty') {
            await writeFile(filePath, 'external contents')
            expect((await stat(filePath)).ino).toBe(original.ino)
            if (change === 'nonempty') {
              const current = await stat(filePath)
              disk.fs.stat.mockReset().mockResolvedValue({
                size: current.size,
                isDirectory: false,
                mtime: current.mtimeMs
              })
            }
          } else if (change === 'replacement') {
            await rename(filePath, join(directory, 'original.md'))
            await writeFile(filePath, '')
            expect((await stat(filePath)).ino).not.toBe(original.ino)
          } else if (change === 'directory') {
            await rm(filePath)
            await mkdir(filePath)
          }
          const store = createUntitledNoteStore('untitled.md')
          if (closeMethod === 'closeAllFiles without a selection') {
            store.setState({ activeWorktreeId: null })
          }

          const result =
            closeMethod === 'closeFile'
              ? store.getState().closeFile(FILE_ID)
              : store.getState().closeAllFiles()
          await new Promise<void>((resolve) => setImmediate(resolve))
          await Promise.allSettled(deletionOperations)

          if (change === 'directory') {
            expect((await stat(filePath)).isDirectory()).toBe(true)
          } else {
            expect(await readFile(filePath, 'utf8')).toBe(
              change === 'late write' || change === 'nonempty' ? 'external contents' : ''
            )
          }
          expect(disk.fs.deletePath).not.toHaveBeenCalled()
          expect(disk.fs.stat).not.toHaveBeenCalled()
          const preserved = {
            status: 'preserved',
            reason: 'atomic-delete-unavailable',
            filePath: FILE_ID
          }
          expect(result).toEqual(closeMethod === 'closeFile' ? preserved : [preserved])
          expect(store.getState().openFiles).toHaveLength(0)
          expect(store.getState().recentlyClosedEditorTabsByWorktree['wt-1']?.[0]).toMatchObject({
            filePath: FILE_ID
          })
          expect(store.getState().reopenClosedEditorTab('wt-1')).toBe(true)
          expect(store.getState().openFiles[0]?.filePath).toBe(FILE_ID)
        }
      )
    }
  )

  it('keeps ordinary explicit deletion available for a real nonempty file', async () => {
    await writeFile(filePath, 'delete explicitly')

    await deleteRuntimePath(
      { settings: { activeRuntimeEnvironmentId: null }, worktreeId: 'wt-1', worktreePath: '/repo' },
      FILE_ID
    )

    await expect(stat(filePath)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(disk.fs.deletePath).toHaveBeenCalledTimes(1)
    expect(disk.fs.stat).not.toHaveBeenCalled()
  })
})
