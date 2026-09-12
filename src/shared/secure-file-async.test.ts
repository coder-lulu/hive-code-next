import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
const acl = vi.hoisted(() => ({ restrictWindowsPathAsync: vi.fn() }))
vi.mock('./secure-path-windows-acl', () => ({
  ...acl,
  bestEffortRestrictWindowsPath: vi.fn(),
  restrictWindowsPathSync: vi.fn(),
  resetSecureFileWindowsUserSidForTests: vi.fn()
}))
import { writeSecureJsonFileAsync } from './secure-file-async'
const directories: string[] = []
const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!
afterEach(() => {
  Object.defineProperty(process, 'platform', originalPlatform)
  for (const dir of directories) {
    rmSync(dir, { recursive: true, force: true })
  }
  vi.resetAllMocks()
})
it('keeps old contents until staged hardening settles and awaits published verification', async () => {
  Object.defineProperty(process, 'platform', { value: 'win32' })
  const dir = mkdtempSync(join(tmpdir(), 'secure-async-'))
  directories.push(dir)
  const target = join(dir, 'token.json')
  writeFileSync(target, 'old')
  let finishStage!: (result: boolean) => void
  let finishPublished!: (result: boolean) => void
  acl.restrictWindowsPathAsync
    .mockResolvedValueOnce(true)
    .mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          finishStage = resolve
        })
    )
    .mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          finishPublished = resolve
        })
    )
  let done = false
  const pending = writeSecureJsonFileAsync(target, { token: 'replacement' }).then((value) => {
    done = true
    return value
  })
  await vi.waitFor(() => expect(acl.restrictWindowsPathAsync).toHaveBeenCalledTimes(2))
  expect(readFileSync(target, 'utf8')).toBe('old')
  expect(done).toBe(false)
  finishStage(true)
  await vi.waitFor(() => expect(acl.restrictWindowsPathAsync).toHaveBeenCalledTimes(3))
  expect(JSON.parse(readFileSync(target, 'utf8'))).toEqual({ token: 'replacement' })
  expect(done).toBe(false)
  finishPublished(false)
  expect(await pending).toBe(false)
  expect(readdirSync(dir)).toEqual(['token.json'])
})
