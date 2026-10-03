import { createHash } from 'node:crypto'
import type * as FileSystemPromises from 'node:fs/promises'
import { mkdir, mkdtemp, readFile, rename, rm, writeFile, type FileHandle } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { verifyManagedPiPackFile } from './managed-pi-pack-files'

let onOpen: ((handle: FileHandle) => Promise<void>) | undefined
let opened: FileHandle | undefined
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof FileSystemPromises>()
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args)
      opened = handle
      await onOpen?.(handle)
      return handle
    }
  }
})

const temporaryRoot = resolve('logs/ai-pack-loader-20260914/tmp')
let root: string
let path: string
beforeEach(async () => {
  onOpen = undefined
  opened = undefined
  await mkdir(temporaryRoot, { recursive: true })
  root = await mkdtemp(join(temporaryRoot, 'file-race-'))
  path = join(root, 'index')
  await writeFile(path, 'verified text')
})
afterEach(async () => {
  onOpen = undefined
  const owned = relative(temporaryRoot, root)
  if (owned && !owned.startsWith('..') && !isAbsolute(owned)) {
    await rm(root, { recursive: true, force: true })
  }
})

describe('Pack file verification', () => {
  it('hashes multiple chunks without retaining mutable buffers as artifact content', async () => {
    const bytes = Buffer.alloc(160_001, 0x7f)
    bytes[70_000] = 0x42
    await writeFile(path, bytes)
    const expected = {
      size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex')
    }
    const file = await verifyManagedPiPackFile(root, 'index', bytes.length, expected)
    expect(file.sha256).toBe(expected.sha256)
    expect(file.content).toBeUndefined()
    expect(file.assertCurrent).not.toThrow()
    await expect(opened!.stat()).rejects.toThrow()
  })

  it('reads bounded index text across UTF-8 chunk boundaries', async () => {
    const content = '界'.repeat(23_000)
    await writeFile(path, content)
    const file = await verifyManagedPiPackFile(root, 'index', Buffer.byteLength(content))
    expect(file.content).toBe(content)
    expect(file.sha256).toBe(createHash('sha256').update(content).digest('hex'))
  })

  it.each(['grow', 'truncate', 'replace'])(
    'rejects %s after opening the verified file and closes its handle',
    async (mode) => {
      onOpen = async () => {
        if (mode === 'grow') {
          await writeFile(path, 'larger unverified text')
        }
        if (mode === 'truncate') {
          await writeFile(path, 'short')
        }
        if (mode === 'replace') {
          await rename(path, join(root, 'previous'))
          await writeFile(path, 'verified text')
        }
      }
      await expect(verifyManagedPiPackFile(root, 'index', 128)).rejects.toThrow()
      await expect(opened!.stat()).rejects.toThrow()
    }
  )

  it('rejects changes during the chunk read, not just before opening', async () => {
    onOpen = async (handle) => {
      const originalRead = handle.read.bind(handle)
      vi.spyOn(handle, 'read').mockImplementation(async (...args) => {
        const result = await originalRead(...args)
        await writeFile(path, 'changed bytes')
        return result
      })
    }
    await expect(verifyManagedPiPackFile(root, 'index', 128)).rejects.toThrow()
    await expect(opened!.stat()).rejects.toThrow()
    expect(await readFile(path, 'utf8')).toBe('changed bytes')
  })
})
