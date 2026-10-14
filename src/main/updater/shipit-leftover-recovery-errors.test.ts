import type * as FsPromises from 'node:fs/promises'
import type * as Os from 'node:os'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  prepareShipItStaging,
  prepareThisProcessShipItStaging,
  shipItStagingOwnersDir
} from './shipit-leftover-recovery'
import { macCoordinationRoot } from '../../shared/serve-bundle-coordination'
import { LOCAL_BUILD_COMPATIBILITY_CONTRACT } from '../../shared/local-build-compatibility-contract'

const injected = vi.hoisted(() => ({ path: '', code: '', home: '' }))
vi.mock('node:fs/promises', async (original) => {
  const fs = await original<typeof FsPromises>()
  return {
    ...fs,
    readdir: vi.fn(async (...args: Parameters<typeof fs.readdir>) => {
      if (String(args[0]) === injected.path) {
        throw Object.assign(new Error('injected read failure'), { code: injected.code })
      }
      return fs.readdir(...args)
    })
  }
})
vi.mock('node:os', async (original) => ({
  ...(await original<typeof Os>()),
  homedir: () => injected.home
}))
vi.mock('../../shared/shipit-process-listing', () => ({
  listProcessCommands: vi.fn(async () => '/sbin/launchd'),
  isShipItRunningForBundleId: vi.fn(() => false)
}))
vi.mock('../updater-lifecycle-diagnostics', () => ({ recordUpdaterLifecycle: vi.fn() }))
let root: string
let cache: string
let coordination: string
const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
const execPath = Object.getOwnPropertyDescriptor(process, 'execPath')!
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'shipit-read-errors-'))
  injected.home = root
  cache = join(root, 'Library', 'Caches', `${LOCAL_BUILD_COMPATIBILITY_CONTRACT.appId}.ShipIt`)
  coordination = join(macCoordinationRoot(root), 'bundle-coordination')
  await mkdir(cache, { recursive: true })
  await writeFile(join(cache, 'ShipItState.plist'), '<plist/>')
  Object.defineProperty(process, 'platform', { ...platform, value: 'darwin' })
  Object.defineProperty(process, 'execPath', {
    ...execPath,
    value: '/Applications/Test.app/Contents/MacOS/Test'
  })
  vi.spyOn(process, 'kill').mockReturnValue(true)
})
afterEach(async () => {
  injected.path = ''
  vi.restoreAllMocks()
  Object.defineProperty(process, 'platform', platform)
  Object.defineProperty(process, 'execPath', execPath)
  await rm(root, { recursive: true, force: true })
})
it.each([
  ['owners', 'EACCES'],
  ['owners', 'EIO'],
  ['cache', 'EACCES'],
  ['cache', 'EIO']
])('refuses %s read failure %s without registration or cache removal', async (target, code) => {
  injected.path = target === 'owners' ? shipItStagingOwnersDir(coordination) : cache
  injected.code = code
  await expect(
    prepareShipItStaging({
      bundleId: 'test',
      cacheDir: cache,
      coordinationDir: coordination,
      pid: 500,
      isProcessAlive: () => true,
      listProcesses: async () => '/sbin/launchd'
    })
  ).rejects.toMatchObject({ code })
  await expect(prepareThisProcessShipItStaging()).resolves.toBe(false)
  expect(existsSync(shipItStagingOwnersDir(coordination))).toBe(false)
  expect(existsSync(join(cache, 'ShipItState.plist'))).toBe(true)
  injected.path = ''
  expect(await readdir(cache)).toEqual(['ShipItState.plist'])
})
