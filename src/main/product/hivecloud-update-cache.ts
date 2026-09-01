import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  parseHiveCloudUpdateDecision,
  type HiveCloudUpdateDecision
} from './hivecloud-update-check'
import { compareProductVersions, isProductVersion } from '../../shared/product-version'

const CACHE_FILE_NAME = 'hivecloud-update-policy.json'

/**
 * `rename` replaces an existing path atomically on POSIX, but Windows returns
 * EEXIST/EPERM when the destination already exists.  Keep the fast atomic
 * path and use a narrowly-scoped replacement fallback for the cache file.
 */
function replaceCacheFile(temporaryPath: string, destinationPath: string): void {
  try {
    renameSync(temporaryPath, destinationPath)
    return
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'EEXIST' && code !== 'EPERM' && code !== 'ENOTEMPTY') {
      throw error
    }
  }
  unlinkSync(destinationPath)
  renameSync(temporaryPath, destinationPath)
}

function cachePath(): string {
  return join(app.getPath('userData'), CACHE_FILE_NAME)
}

/** Persist only a mandatory policy so ordinary/offline checks never replay stale offers. */
export function cacheMandatoryHiveCloudDecision(decision: HiveCloudUpdateDecision): void {
  if (
    !decision.hasUpdate ||
    (!decision.updateRequired && !decision.latest?.mandatory) ||
    !decision.latest
  ) {
    clearCachedMandatoryHiveCloudDecision()
    return
  }
  try {
    const path = cachePath()
    mkdirSync(app.getPath('userData'), { recursive: true })
    const temporaryPath = `${path}.tmp-${process.pid}`
    writeFileSync(temporaryPath, JSON.stringify({ decision, cachedAt: Date.now() }), {
      encoding: 'utf8',
      mode: 0o600
    })
    try {
      replaceCacheFile(temporaryPath, path)
    } finally {
      // A failed replacement must not leave a stale, readable policy beside
      // the canonical cache file.
      if (existsSync(temporaryPath)) {
        unlinkSync(temporaryPath)
      }
    }
  } catch {
    // A cache is a safety enhancement, not a reason to fail a successful check.
  }
}

export function readCachedMandatoryHiveCloudDecision(
  currentBuild?: number
): HiveCloudUpdateDecision | null {
  try {
    const path = cachePath()
    if (!existsSync(path)) {
      return null
    }
    const cached = JSON.parse(readFileSync(path, 'utf8')) as {
      decision?: unknown
      cachedAt?: unknown
    }
    if (typeof cached.cachedAt !== 'number' || !Number.isFinite(cached.cachedAt)) {
      return null
    }
    // Mandatory policy is cleared only by a later successful non-mandatory
    // check or by installing a different build. Expiring it by wall-clock age
    // would let a device fail open simply by remaining offline (or changing
    // its clock) for longer than the normal update-check interval.
    const decision = parseHiveCloudUpdateDecision(cached.decision)
    if (
      !decision?.hasUpdate ||
      !decision.latest ||
      (!decision.updateRequired && !decision.latest.mandatory)
    ) {
      return null
    }
    // The policy is bound to the exact client build that fetched it.  Without
    // this check, a cached mandatory decision for an older build could be
    // replayed after a reinstall/rollback and block an unrelated installation.
    if (currentBuild !== undefined && decision.currentBuild !== currentBuild) {
      return null
    }
    // A malformed legacy package version must not turn an already cached
    // mandatory policy into a fail-open path.  Only perform the stale-offer
    // optimization when the local version is comparable; otherwise retain the
    // mandatory decision and keep the client blocked until it can re-check.
    const localVersion = app.getVersion()
    if (isProductVersion(localVersion)) {
      const versionOrder = compareProductVersions(decision.latest.versionName, localVersion)
      if (
        versionOrder < 0 ||
        (versionOrder === 0 &&
          currentBuild !== undefined &&
          decision.latest.buildNumber <= currentBuild)
      ) {
        return null
      }
    }
    return decision
  } catch {
    return null
  }
}

export function clearCachedMandatoryHiveCloudDecision(): void {
  try {
    const path = cachePath()
    if (existsSync(path)) {
      // Keep this recoverable and race-safe: an empty policy is equivalent to
      // no cache and avoids deleting unrelated user data on a malformed path.
      writeFileSync(path, '{"decision":null}\n', { encoding: 'utf8', mode: 0o600 })
    }
  } catch {
    // Best effort; a later successful non-mandatory check will overwrite it.
  }
}
