import { mkdir, mkdtemp, open, readFile, readdir, rm, unlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  prepareShipItStaging,
  shipItInstallLockPath,
  shipItStagingOwnersDir,
  type ShipItStagingDeps
} from './shipit-leftover-recovery'

const SHIPIT = '/Applications/Orca Beta.app/Contents/Frameworks/Squirrel.framework/Resources/ShipIt'

describe('prepareShipItStaging', () => {
  let root: string
  let cacheDir: string
  let coordinationDir: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'orca-shipit-recovery-'))
    cacheDir = join(root, 'Caches', 'com.stablyai.orca.ShipIt')
    coordinationDir = join(root, 'coordination')
    await mkdir(join(cacheDir, 'update.6rnCgPu', 'Orca.app'), { recursive: true })
    await writeFile(join(cacheDir, 'ShipItState.plist'), '<plist/>')
    await writeFile(join(cacheDir, 'ShipIt_stderr.log'), 'Code=-9 "App Still Running Error"')
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  const deps = (overrides: Partial<ShipItStagingDeps> = {}): ShipItStagingDeps => ({
    bundleId: 'com.stablyai.orca',
    cacheDir,
    coordinationDir,
    pid: 500,
    isProcessAlive: (pid) => pid === 500,
    listProcesses: vi.fn(async () => '/sbin/launchd\n/usr/bin/login\n'),
    ...overrides
  })

  const leftovers = (): boolean =>
    existsSync(join(cacheDir, 'ShipItState.plist')) || existsSync(join(cacheDir, 'update.6rnCgPu'))

  it('clears a dead install request so Squirrel can stage again, keeping its logs', async () => {
    await expect(prepareShipItStaging(deps())).resolves.toEqual({
      kind: 'recovered',
      removed: ['ShipItState.plist', 'update.6rnCgPu']
    })
    expect(leftovers()).toBe(false)
    expect(existsSync(join(cacheDir, 'ShipIt_stderr.log'))).toBe(true)
    expect(existsSync(shipItInstallLockPath(coordinationDir))).toBe(false)
    expect(await readdir(shipItStagingOwnersDir(coordinationDir))).toEqual(['500'])
  })

  it('leaves the cache alone while another live Orca owns staged state', async () => {
    await mkdir(shipItStagingOwnersDir(coordinationDir), { recursive: true })
    await writeFile(join(shipItStagingOwnersDir(coordinationDir), '600'), '')
    const live = deps({ isProcessAlive: (pid) => pid === 500 || pid === 600 })
    await expect(prepareShipItStaging(live)).resolves.toEqual({
      kind: 'skipped',
      reason: 'owner-live'
    })
    expect(leftovers()).toBe(true)
    // Refused admission cannot register a new staging owner.
    expect((await readdir(shipItStagingOwnersDir(coordinationDir))).sort()).toEqual(['600'])

    // Once that owner is gone, its record no longer protects anything.
    await expect(prepareShipItStaging(deps())).resolves.toMatchObject({ kind: 'recovered' })
    expect(await readdir(shipItStagingOwnersDir(coordinationDir))).toEqual(['500'])
  })

  it('ignores the ShipIt of another app', async () => {
    const other = deps({
      listProcesses: async () =>
        '/Applications/Other.app/Contents/Frameworks/Squirrel.framework/Resources/ShipIt com.other.ShipIt /x\n'
    })
    await expect(prepareShipItStaging(other)).resolves.toMatchObject({ kind: 'recovered' })
  })

  it('never clears while ShipIt runs, or when that cannot be checked', async () => {
    const running = deps({ listProcesses: async () => `${SHIPIT} com.stablyai.orca.ShipIt\n` })
    await expect(prepareShipItStaging(running)).resolves.toEqual({
      kind: 'skipped',
      reason: 'installer-running'
    })
    const unknown = deps({ listProcesses: async () => null })
    await expect(prepareShipItStaging(unknown)).resolves.toEqual({
      kind: 'skipped',
      reason: 'installer-unknown'
    })
    expect(leftovers()).toBe(true)
    expect(existsSync(shipItInstallLockPath(coordinationDir))).toBe(false)
  })

  it('takes the install lock: a live holder wins, a dead one is reclaimed', async () => {
    await mkdir(coordinationDir, { recursive: true })
    await writeFile(shipItInstallLockPath(coordinationDir), JSON.stringify({ pid: 600 }))
    const held = deps({ isProcessAlive: (pid) => pid === 500 || pid === 600 })
    await expect(prepareShipItStaging(held)).resolves.toEqual({
      kind: 'skipped',
      reason: 'locked'
    })
    expect(leftovers()).toBe(true)

    await expect(prepareShipItStaging(deps())).resolves.toMatchObject({ kind: 'recovered' })
    expect(existsSync(shipItInstallLockPath(coordinationDir))).toBe(false)
  })

  it.each(['', '{"pid":', '{"pid":600', '{"pid":"600"}', '{"pid":0}'])(
    'refuses unknown lock holder %j',
    async (record) => {
      await mkdir(coordinationDir, { recursive: true })
      const path = shipItInstallLockPath(coordinationDir)
      await writeFile(path, record)
      await expect(prepareShipItStaging(deps())).resolves.toEqual({
        kind: 'skipped',
        reason: 'locked'
      })
      expect(await readFile(path, 'utf8')).toBe(record)
      expect(leftovers()).toBe(true)
      expect(existsSync(shipItStagingOwnersDir(coordinationDir))).toBe(false)
    }
  )

  it('does not register an unprotected owner when the cache is empty', async () => {
    await rm(cacheDir, { recursive: true, force: true })
    await mkdir(coordinationDir, { recursive: true })
    await writeFile(shipItInstallLockPath(coordinationDir), '')
    await expect(prepareShipItStaging(deps())).resolves.toEqual({
      kind: 'skipped',
      reason: 'locked'
    })
    expect(existsSync(shipItStagingOwnersDir(coordinationDir))).toBe(false)
  })

  it('does not delete a replacement lock or its cache during release', async () => {
    const path = shipItInstallLockPath(coordinationDir)
    const foreign = JSON.stringify({ pid: 600, token: 'successor' })
    await expect(
      prepareShipItStaging(
        deps({
          listProcesses: async () => {
            await unlink(path)
            await writeFile(path, foreign)
            return '/sbin/launchd'
          }
        })
      )
    ).resolves.toEqual({ kind: 'skipped', reason: 'locked' })
    expect(await readFile(path, 'utf8')).toBe(foreign)
    expect(leftovers()).toBe(true)
    expect(existsSync(shipItStagingOwnersDir(coordinationDir))).toBe(false)
  })

  it('serializes competing dead-lock reclaimers and registers only the admitted owner', async () => {
    await mkdir(coordinationDir, { recursive: true })
    await writeFile(
      shipItInstallLockPath(coordinationDir),
      JSON.stringify({ pid: 600, token: 'dead' })
    )
    const results = await Promise.all([
      prepareShipItStaging(deps()),
      prepareShipItStaging(deps({ pid: 700 }))
    ])
    expect(results.filter((result) => result.kind === 'recovered')).toHaveLength(1)
    expect(results.filter((result) => result.kind === 'skipped')).toHaveLength(1)
    expect(await readdir(shipItStagingOwnersDir(coordinationDir))).toHaveLength(1)
  })

  it('keeps admission serialized while recovery is reading the process list', async () => {
    const d = deps({
      listProcesses: async () => {
        const record = JSON.parse(await readFile(shipItInstallLockPath(coordinationDir), 'utf8'))
        expect(record).toMatchObject({ pid: 500, token: expect.any(String) })
        await expect(prepareShipItStaging(deps({ pid: 700 }))).resolves.toEqual({
          kind: 'skipped',
          reason: 'locked'
        })
        expect(existsSync(shipItStagingOwnersDir(coordinationDir))).toBe(false)
        return '/sbin/launchd'
      }
    })
    await expect(prepareShipItStaging(d)).resolves.toMatchObject({ kind: 'recovered' })
    expect(await readdir(shipItStagingOwnersDir(coordinationDir))).toEqual(['500'])
  })

  it('refuses an abandoned pathname guard instead of guessing its age', async () => {
    await mkdir(`${shipItInstallLockPath(coordinationDir)}.guard`, { recursive: true })
    await expect(prepareShipItStaging(deps())).resolves.toEqual({
      kind: 'skipped',
      reason: 'locked'
    })
    expect(leftovers()).toBe(true)
  })

  it('checks owners even when no leftover cache exists', async () => {
    await rm(cacheDir, { recursive: true, force: true })
    await mkdir(shipItStagingOwnersDir(coordinationDir), { recursive: true })
    await writeFile(join(shipItStagingOwnersDir(coordinationDir), '600'), '')
    await expect(prepareShipItStaging(deps({ isProcessAlive: () => true }))).resolves.toEqual({
      kind: 'skipped',
      reason: 'owner-live'
    })
    expect(await readdir(shipItStagingOwnersDir(coordinationDir))).toEqual(['600'])
  })

  it('preserves the actual exclusive-open before PID publication window', async () => {
    await mkdir(coordinationDir, { recursive: true })
    const path = shipItInstallLockPath(coordinationDir)
    const holder = await open(path, 'wx')
    try {
      await expect(prepareShipItStaging(deps())).resolves.toEqual({
        kind: 'skipped',
        reason: 'locked'
      })
      await holder.writeFile('{"pid":')
      await expect(prepareShipItStaging(deps())).resolves.toEqual({
        kind: 'skipped',
        reason: 'locked'
      })
      expect(await readFile(path, 'utf8')).toBe('{"pid":')
      expect(leftovers()).toBe(true)
    } finally {
      await holder.close()
    }
  })

  it('requires file identity even when a replacement copies the original token', async () => {
    const path = shipItInstallLockPath(coordinationDir)
    let replacement = ''
    await expect(
      prepareShipItStaging(
        deps({
          listProcesses: async () => {
            replacement = await readFile(path, 'utf8')
            // Keep the original inode allocated so the filesystem cannot reuse its identity.
            const original = await open(path, 'r')
            try {
              await unlink(path)
              await writeFile(path, replacement)
            } finally {
              await original.close()
            }
            return '/sbin/launchd'
          }
        })
      )
    ).resolves.toEqual({ kind: 'skipped', reason: 'locked' })
    expect(await readFile(path, 'utf8')).toBe(replacement)
    expect(leftovers()).toBe(true)
  })

  it('retries brief release-guard contention without abandoning its live lock', async () => {
    const guard = `${shipItInstallLockPath(coordinationDir)}.guard`
    let unlock: Promise<void> | undefined
    const result = await prepareShipItStaging(
      deps({
        listProcesses: async () => {
          await mkdir(guard)
          unlock = new Promise<void>((resolve, reject) =>
            setTimeout(() => {
              rm(guard, { recursive: true }).then(resolve, reject)
            }, 30)
          )
          return '/sbin/launchd'
        }
      })
    )
    await unlock
    expect(result.kind).toBe('recovered')
    expect(existsSync(shipItInstallLockPath(coordinationDir))).toBe(false)
  })

  it('does nothing extra when there is nothing left over', async () => {
    await rm(cacheDir, { recursive: true, force: true })
    const d = deps()
    await expect(prepareShipItStaging(d)).resolves.toEqual({ kind: 'clean' })
    expect(d.listProcesses).not.toHaveBeenCalled()
    expect(await readdir(shipItStagingOwnersDir(coordinationDir))).toEqual(['500'])
  })
})
