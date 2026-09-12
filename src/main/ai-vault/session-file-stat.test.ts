import type * as FsPromises from 'node:fs/promises'
import type { Stats } from 'node:fs'
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { discoverFiles } from './session-scanner-discovery'
import { statSessionFile } from './session-file-stat'
import * as WslFs from '../native-chat/wsl-transcript-fs-access'

const statProbe = vi.hoisted(() => vi.fn())
vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof FsPromises>('node:fs/promises')
  return {
    ...actual,
    stat: async (...args: Parameters<typeof actual.stat>) => {
      const result = await actual.stat(...args)
      const identity = statProbe(...args)
      return identity && result ? Object.assign(result, identity) : result
    }
  }
})

let root: string | undefined
afterEach(async () => {
  if (root) {
    await rm(root, { recursive: true, force: true })
  }
  root = undefined
  statProbe.mockReset()
  vi.restoreAllMocks()
})

it('captures exact native filesystem identity in the existing single stat acquisition', async () => {
  const logDir = join(process.cwd(), 'logs')
  await mkdir(logDir, { recursive: true })
  root = await mkdtemp(join(logDir, 'fts-stat-identity-'))
  const path = join(root, 'session.jsonl')
  await writeFile(path, '{}\n')
  const exact = await stat(path, { bigint: true })
  const numeric = await stat(path)
  statProbe.mockClear()
  const discovery = await discoverFiles({
    rootDir: root, agent: 'claude', limit: 10, extensions: ['.jsonl'], issues: []
  })
  expect(discovery.files[0]?.filesystemIdentity).toEqual({
    dev: String(exact.dev), ino: String(exact.ino)
  })
  expect(discovery.files[0]?.mtimeMs).toBe(numeric.mtimeMs)
  expect(typeof discovery.files[0]?.dev).toBe('number')
  expect(typeof discovery.files[0]?.ino).toBe('number')
  expect(statProbe.mock.calls).toEqual([[path, { bigint: true }]])
})

it.each([9_007_199_254_740_992n, 9_007_199_254_740_993n])(
  'captures oversized stat inode %s before numeric metadata loses precision',
  async (ino) => {
    const logDir = join(process.cwd(), 'logs')
    await mkdir(logDir, { recursive: true })
    root = await mkdtemp(join(logDir, 'fts-stat-identity-'))
    const path = join(root, 'session.jsonl')
    await writeFile(path, '{}\n')
    statProbe.mockReturnValue({ dev: 42n, ino })
    const observed = await statSessionFile(path)
    expect(observed.filesystemIdentity).toEqual({ dev: '42', ino: String(ino) })
    expect(observed.ino).toBe(Number(ino))
    expect(statProbe.mock.calls).toEqual([[path, { bigint: true }]])
  }
)

it.each([
  [7, { dev: '42', ino: '7' }],
  [9_007_199_254_740_992, null]
])('keeps UNC stat inside the WSL gate and refuses an unsafe observation %s', async (ino, identity) => {
  const path = '\\\\wsl.localhost\\Ubuntu\\home\\ada\\session.jsonl'
  const gated = vi.spyOn(WslFs, 'wslGatedStat').mockResolvedValue({ dev: 42, ino } as Stats)
  if (identity) {
    expect((await statSessionFile(path)).filesystemIdentity).toEqual(identity)
  } else {
    await expect(statSessionFile(path)).rejects.toThrow(/identity/i)
  }
  expect(gated).toHaveBeenCalledWith(path, 'scan')
  expect(statProbe).not.toHaveBeenCalled()
})
