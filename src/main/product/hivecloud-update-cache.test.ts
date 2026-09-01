import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const testState = { userData: '', version: '1.5.0-beta.1' }

vi.mock('electron', () => ({
  app: {
    getPath: () => testState.userData,
    getVersion: () => testState.version
  }
}))

import {
  cacheMandatoryHiveCloudDecision,
  clearCachedMandatoryHiveCloudDecision,
  readCachedMandatoryHiveCloudDecision
} from './hivecloud-update-cache'

function mandatoryDecision(currentBuild = 13) {
  return {
    hasUpdate: true,
    updateRequired: true,
    blockReason: 'below_min_supported_build',
    currentBuild,
    minimumSupportedBuild: 14,
    artifact: null,
    latest: {
      versionName: '1.5.0-beta.1',
      buildNumber: 14,
      releaseNotes: 'Update required',
      mandatory: false,
      publishedAt: '2026-08-30T00:00:00Z',
      artifact: null
    }
  }
}

describe('HiveCloud mandatory update cache', () => {
  beforeEach(() => {
    testState.userData = mkdtempSync(join(tmpdir(), 'hivecloud-update-cache-'))
    testState.version = '1.5.0-beta.1'
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-30T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
    rmSync(testState.userData, { recursive: true, force: true })
  })

  it('replays a policy only for the exact client build that fetched it', () => {
    cacheMandatoryHiveCloudDecision(mandatoryDecision(13))

    expect(readCachedMandatoryHiveCloudDecision(13)?.currentBuild).toBe(13)
    expect(readCachedMandatoryHiveCloudDecision(12)).toBeNull()
    expect(readCachedMandatoryHiveCloudDecision(14)).toBeNull()
  })

  it('replaces an existing policy when a newer mandatory decision arrives', () => {
    cacheMandatoryHiveCloudDecision(mandatoryDecision(13))
    const newer = mandatoryDecision(13)
    newer.latest.buildNumber = 15
    cacheMandatoryHiveCloudDecision(newer)

    expect(readCachedMandatoryHiveCloudDecision(13)?.latest?.buildNumber).toBe(15)
  })

  it('clears a cached policy without deleting unrelated user data', () => {
    cacheMandatoryHiveCloudDecision(mandatoryDecision())
    clearCachedMandatoryHiveCloudDecision()

    expect(readCachedMandatoryHiveCloudDecision(13)).toBeNull()
  })

  it('replays a release-level mandatory flag when the check endpoint is offline', () => {
    const decision = mandatoryDecision(13)
    decision.updateRequired = false
    decision.minimumSupportedBuild = null
    decision.latest.mandatory = true

    cacheMandatoryHiveCloudDecision(decision)

    expect(readCachedMandatoryHiveCloudDecision(13)?.latest?.mandatory).toBe(true)
  })

  it('does not cache a mandatory release when this client has no update', () => {
    const decision = mandatoryDecision(13)
    decision.hasUpdate = false
    decision.updateRequired = false
    decision.minimumSupportedBuild = null
    decision.latest.mandatory = true

    cacheMandatoryHiveCloudDecision(decision)

    expect(readCachedMandatoryHiveCloudDecision(13)).toBeNull()
  })

  it('keeps a cached mandatory policy when a legacy local version is not comparable', () => {
    cacheMandatoryHiveCloudDecision(mandatoryDecision(13))
    testState.version = '1.4.178-rc.7.legacy'

    expect(readCachedMandatoryHiveCloudDecision(13)?.updateRequired).toBe(true)
  })

  it('keeps a cached mandatory policy after the normal 24-hour check interval', () => {
    const now = Date.now()
    cacheMandatoryHiveCloudDecision(mandatoryDecision(13))
    vi.setSystemTime(now + 30 * 24 * 60 * 60 * 1000)

    expect(readCachedMandatoryHiveCloudDecision(13)?.updateRequired).toBe(true)
  })
})
