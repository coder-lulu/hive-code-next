/** Recovers abandoned Squirrel staging only under exclusive, verified ownership. */
import { setTimeout as delay } from 'node:timers/promises'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { mkdir, open, readdir, rm, rmdir, unlink, writeFile } from 'node:fs/promises'
import { macCoordinationRoot } from '../../shared/serve-bundle-coordination'
import {
  isShipItRunningForBundleId,
  listProcessCommands
} from '../../shared/shipit-process-listing'
import { LOCAL_BUILD_COMPATIBILITY_CONTRACT } from '../../shared/local-build-compatibility-contract'
import { recordUpdaterLifecycle } from '../updater-lifecycle-diagnostics'

export type ShipItStagingDeps = {
  bundleId: string
  cacheDir: string
  coordinationDir: string
  pid: number
  isProcessAlive: (pid: number) => boolean
  listProcesses: () => Promise<string | null>
}

export type ShipItStagingResult =
  | { kind: 'clean' }
  | { kind: 'recovered'; removed: string[] }
  | {
      kind: 'skipped'
      reason: 'locked' | 'owner-live' | 'installer-running' | 'installer-unknown'
    }

const SHIPIT_STATE_FILE = 'ShipItState.plist'
const STAGED_UPDATE_PATTERN = /^update\.[A-Za-z0-9]+$/

export const shipItInstallLockPath = (coordinationDir: string): string =>
  join(coordinationDir, 'install.lock')
/** One empty file per process that staged (or is about to stage) an update in the shared cache. */
export const shipItStagingOwnersDir = (coordinationDir: string): string =>
  join(coordinationDir, 'shipit-staging-owners')

const isPidName = (name: string): boolean => /^[1-9]\d*$/.test(name)

function missingDirectory(error: unknown): [] {
  if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
    return []
  }
  throw error
}

async function leftoverNames(cacheDir: string): Promise<string[]> {
  const names = await readdir(cacheDir).catch(missingDirectory)
  return names.filter((name) => name === SHIPIT_STATE_FILE || STAGED_UPDATE_PATTERN.test(name))
}

type InstallLock = { owns: () => Promise<boolean>; release: () => Promise<void> }

/** Serializes pathname changes, including competing stale reclaimers. An abandoned guard fails closed. */
async function withLockGuard<T>(path: string, action: () => Promise<T>): Promise<T | null> {
  const guard = `${path}.guard`
  try {
    await mkdir(guard, { mode: 0o700 })
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
      return null
    }
    throw error
  }
  try {
    return await action()
  } finally {
    await rmdir(guard)
  }
}

async function readLock(path: string) {
  try {
    const handle = await open(path, 'r')
    try {
      const identity = await handle.stat()
      const text = await handle.readFile('utf8')
      return { identity, text }
    } finally {
      await handle.close()
    }
  } catch {
    return null
  }
}

async function matchesLock(
  path: string,
  expected: NonNullable<Awaited<ReturnType<typeof readLock>>>
) {
  const current = await readLock(path)
  return (
    current !== null &&
    current.identity.dev === expected.identity.dev &&
    current.identity.ino === expected.identity.ino &&
    current.text === expected.text
  )
}

/** Unknown records are never evidence of death, including the open-before-write window. */
async function acquireInstallLock(deps: ShipItStagingDeps): Promise<InstallLock | null> {
  const path = shipItInstallLockPath(deps.coordinationDir)
  await mkdir(deps.coordinationDir, { recursive: true, mode: 0o700 })
  return withLockGuard(path, async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const handle = await open(path, 'wx', 0o600)
        let identity
        const text = JSON.stringify({ pid: deps.pid, token: randomUUID() })
        try {
          await handle.writeFile(text)
          await handle.sync()
          identity = await handle.stat()
        } finally {
          await handle.close()
        }
        const expected = { identity, text }
        const owns = () => matchesLock(path, expected)
        return {
          owns,
          release: async () => {
            for (let attempt = 0; attempt < 50; attempt++) {
              const released = await withLockGuard(path, async () => {
                if (await owns()) {
                  await unlink(path)
                }
                return true
              })
              if (released) {
                return
              }
              await delay(10)
            }
            throw new Error('ShipIt lock release guard unavailable')
          }
        }
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) {
          throw error
        }
      }
      const holder = await readLock(path)
      if (!holder) {
        return null
      }
      let record: { pid?: unknown; token?: unknown }
      try {
        record = JSON.parse(holder.text)
      } catch {
        return null
      }
      if (
        !record ||
        typeof record.pid !== 'number' ||
        !Number.isSafeInteger(record.pid) ||
        record.pid <= 0 ||
        (record.token !== undefined &&
          (typeof record.token !== 'string' || record.token.length === 0)) ||
        deps.isProcessAlive(record.pid)
      ) {
        return null
      }
      // Same parser accepts the pre-token record, but only its exact immutable inode can be reclaimed.
      if (!(await matchesLock(path, holder))) {
        return null
      }
      await unlink(path)
    }
    return null
  })
}

async function registerOwner(deps: ShipItStagingDeps): Promise<void> {
  const dir = shipItStagingOwnersDir(deps.coordinationDir)
  await mkdir(dir, { recursive: true, mode: 0o700 })
  await writeFile(join(dir, String(deps.pid)), '')
}

/** Live owners other than this process; records of dead ones are removed on the way. */
async function otherLiveOwners(deps: ShipItStagingDeps): Promise<number[]> {
  const dir = shipItStagingOwnersDir(deps.coordinationDir)
  const live: number[] = []
  for (const name of await readdir(dir).catch(missingDirectory)) {
    const pid = Number(name)
    if (!isPidName(name) || pid === deps.pid) {
      continue
    }
    if (deps.isProcessAlive(pid)) {
      live.push(pid)
    } else {
      await rm(join(dir, name), { force: true })
    }
  }
  return live
}

/** Recovery and staging-owner admission share the same lock, even for an empty cache. */
export async function prepareShipItStaging(deps: ShipItStagingDeps): Promise<ShipItStagingResult> {
  const lock = await acquireInstallLock(deps)
  if (!lock) {
    return { kind: 'skipped', reason: 'locked' }
  }
  try {
    if ((await otherLiveOwners(deps)).length > 0) {
      return { kind: 'skipped', reason: 'owner-live' }
    }
    const result =
      (await leftoverNames(deps.cacheDir)).length === 0
        ? { kind: 'clean' as const }
        : await recoverUnderLock(deps, lock)
    if (!(await lock.owns())) {
      return { kind: 'skipped', reason: 'locked' }
    }
    if (result.kind !== 'skipped') {
      await registerOwner(deps)
    }
    return result
  } finally {
    await lock.release()
  }
}

async function recoverUnderLock(
  deps: ShipItStagingDeps,
  lock: InstallLock
): Promise<ShipItStagingResult> {
  const listing = await deps.listProcesses()
  if (listing === null) {
    return { kind: 'skipped', reason: 'installer-unknown' }
  }
  // Why by bundle id: the cache is shared by every copy of Orca, and other apps' ShipIt is irrelevant.
  if (isShipItRunningForBundleId(listing, deps.bundleId)) {
    return { kind: 'skipped', reason: 'installer-running' }
  }
  // Why again: an owner may have registered while the process list was read.
  if ((await otherLiveOwners(deps)).length > 0) {
    return { kind: 'skipped', reason: 'owner-live' }
  }
  const removed = (await leftoverNames(deps.cacheDir)).sort()
  for (const name of removed) {
    if (!(await lock.owns())) {
      return { kind: 'skipped', reason: 'locked' }
    }
    await rm(join(deps.cacheDir, name), { recursive: true, force: true })
  }
  return { kind: 'recovered', removed }
}

/**
 * This process's staging step, or null when it is not a packaged macOS app (tests, dev, other
 * platforms). Never throws; false refuses staging when exclusive admission cannot be established.
 */
export function prepareThisProcessShipItStaging(): Promise<boolean> | null {
  if (process.platform !== 'darwin' || !process.execPath.includes('.app/Contents/MacOS/')) {
    return null
  }
  const home = homedir()
  const bundleId = LOCAL_BUILD_COMPATIBILITY_CONTRACT.appId
  return prepareShipItStaging({
    bundleId,
    cacheDir: join(home, 'Library', 'Caches', `${bundleId}.ShipIt`),
    coordinationDir: join(macCoordinationRoot(home), 'bundle-coordination'),
    pid: process.pid,
    isProcessAlive: (pid) => {
      try {
        process.kill(pid, 0)
        return true
      } catch (error) {
        return !(error instanceof Error && 'code' in error && error.code === 'ESRCH')
      }
    },
    listProcesses: listProcessCommands
  }).then(
    (result) => {
      if (result.kind !== 'clean') {
        recordUpdaterLifecycle('macos_shipit_leftovers', {
          outcome: result.kind,
          detail: result.kind === 'recovered' ? result.removed.join(', ') : result.reason
        })
      }
      return result.kind !== 'skipped'
    },
    (error: unknown) => {
      recordUpdaterLifecycle(
        'macos_shipit_leftovers',
        { outcome: 'failed', detail: error instanceof Error ? error.name : typeof error },
        { level: 'warn', message: 'Could not check leftover macOS update state' }
      )
      return false
    }
  )
}
