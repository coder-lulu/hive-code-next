import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, renameSync, appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type * as FsPromises from 'node:fs/promises'
const io = vi.hoisted(() => ({
  bytes: 0,
  closes: 0,
  beforeRead: null as (() => void) | null,
  beforeOpen: null as (() => void) | null
}))
vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof FsPromises>('node:fs/promises')
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      io.beforeOpen?.()
      const handle = await actual.open(...args)
      const read = handle.read.bind(handle),
        close = handle.close.bind(handle)
      vi.spyOn(handle, 'read').mockImplementation(async (...args) => {
        const action = io.beforeRead
        io.beforeRead = null
        action?.()
        const result = await read(...args)
        io.bytes += result.bytesRead
        return result
      })
      vi.spyOn(handle, 'close').mockImplementation(async () => {
        io.closes++
        await close()
      })
      return handle
    }
  }
})
import {
  openJsonlFileReader,
  validateJsonlFileReader,
  jsonlPhysicalFileId
} from './jsonl-file-checkpoint'
import { captureJsonlFileFingerprint, verifyJsonlFileFingerprint } from './jsonl-file-fingerprint'
let dir: string, file: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jsonl-fingerprint-'))
  file = join(dir, 'file')
  io.bytes = 0
  io.closes = 0
  io.beforeRead = null
  io.beforeOpen = null
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})
async function captured(size: number) {
  const contents = Buffer.alloc(size, 97)
  writeFileSync(file, contents)
  const reader = await openJsonlFileReader(file)
  reader.onChunk(contents)
  const fingerprint = captureJsonlFileFingerprint(reader)
  expect(await validateJsonlFileReader(reader)).toBe(true)
  await reader.handle.close()
  io.bytes = 0
  io.closes = 0
  return {
    fingerprint,
    observed: { ...reader.stats, physicalFileId: jsonlPhysicalFileId(reader.stats) }
  }
}
it.each([0, 1, 4095, 4096, 4097, 8191, 8192, 8193, 12288, 12289, 32768])(
  'validates captured size %i within 8192 bytes',
  async (size) => {
    const { fingerprint, observed } = await captured(size)
    expect(fingerprint?.size).toBe(size)
    expect(
      await verifyJsonlFileFingerprint(file, observed, JSON.parse(JSON.stringify(fingerprint)))
    ).toBe(true)
    expect(io.bytes).toBeLessThanOrEqual(8192)
    expect(io.closes).toBe(1)
  }
)
it.each(['replace', 'shrink', 'grow'] as const)(
  'rejects %s while the same handle is being checked',
  async (kind) => {
    const { fingerprint, observed } = await captured(16384)
    io.beforeRead = () => {
      if (kind === 'replace') {
        renameSync(file, `${file}.old`)
        writeFileSync(file, Buffer.alloc(16384, 98))
      } else if (kind === 'shrink') {
        writeFileSync(file, 'short')
      } else {
        appendFileSync(file, 'growing')
      }
    }
    expect(await verifyJsonlFileFingerprint(file, observed, fingerprint)).toBe(false)
    expect(io.closes).toBe(1)
  }
)
it('binds the opened generation to the scanner observation before reading', async () => {
  const { fingerprint, observed } = await captured(16384)
  io.beforeOpen = () => {
    io.beforeOpen = null
    renameSync(file, `${file}.old`)
    writeFileSync(file, Buffer.alloc(16384, 97))
  }
  expect(await verifyJsonlFileFingerprint(file, observed, fingerprint)).toBe(false)
  expect(io.bytes).toBe(0)
  expect(io.closes).toBe(1)
})
it('propagates read errors while closing its handle', async () => {
  const { fingerprint, observed } = await captured(16384)
  io.beforeRead = () => {
    throw new Error('fingerprint read failure')
  }
  await expect(verifyJsonlFileFingerprint(file, observed, fingerprint)).rejects.toThrow(
    'fingerprint read failure'
  )
  expect(io.closes).toBe(1)
})
