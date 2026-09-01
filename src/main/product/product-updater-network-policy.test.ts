import { describe, expect, it } from 'vitest'
import {
  isAllowedProductUpdaterRedirectTarget,
  isAllowedProductUpdaterRequest,
  isFinalUpdaterArtifactUrl,
  isFinalUpdaterRedirectArtifactUrl
} from './product-updater-network-policy'

const feed = 'https://updates.hivekernel.example/hive/v1/updates/desktop/stable/windows/x64/'
const internalFeed =
  'https://updates.hivekernel.example/hive/v1/updates/desktop/internal/windows/x64/'
const artifact =
  'https://updates.hivekernel.example/hive/v1/update-artifacts/4f1f7c54-06f2-4a22-b4a9-26c9c9b0c3f5/download'
const internalArtifact =
  'https://updates.hivekernel.example/hive/v1/internal-update-artifacts/4f1f7c54-06f2-4a22-b4a9-26c9c9b0c3f5/download'

describe('HiveCloud updater network policy', () => {
  it.each([`${feed}latest.yml`, `${feed}latest.yml?noCache=1j4abc`, artifact])(
    'allows an authoritative HiveCloud request: %s',
    (url) => {
      expect(isAllowedProductUpdaterRequest(url, null, 'release', null, [], feed)).toBe(true)
    }
  )

  it.each([
    `${feed}HiveCode.exe`,
    `${feed}latest.yml/extra`,
    `${feed}latest.yml?token=secret`,
    'https://cdn.example/HiveCode.exe',
    'https://updates.hivekernel.example/hive/v1/update-artifacts/not-a-uuid/download',
    `${artifact}?token=secret`
  ])('blocks requests outside the immutable HiveCloud capability: %s', (url) => {
    expect(isAllowedProductUpdaterRequest(url, null, 'release', null, [], feed)).toBe(false)
  })

  it.each([
    'https://updates.hivekernel.example/hive/v1/updates/desktop/beta/windows/x64',
    'https://updates.hivekernel.example/hive/v1/updates/desktop/beta/windows/x64/extra/',
    'https://updates.hivekernel.example/hive/v1/updates/desktop/beta/windows/mips/'
  ])('fails closed for a malformed configured feed: %s', (malformedFeed) => {
    expect(
      isAllowedProductUpdaterRequest(
        `${malformedFeed.replace(/\/$/, '')}/latest.yml`,
        'stablyai/orca',
        'release',
        null,
        [],
        malformedFeed
      )
    ).toBe(false)
    expect(
      isAllowedProductUpdaterRedirectTarget(
        'https://release-assets.githubusercontent.com/orca/Orca.exe',
        'stablyai/orca',
        'release',
        null,
        malformedFeed
      )
    ).toBe(false)
  })

  it('does not grant a HiveCloud feed GitHub redirect authority', () => {
    for (const url of [
      `${feed}HiveCode.exe`,
      'https://github.com/stablyai/orca/releases/download/v1.0.0/Orca.exe',
      'https://release-assets.githubusercontent.com/orca/Orca.exe'
    ]) {
      expect(
        isAllowedProductUpdaterRedirectTarget(url, 'stablyai/orca', 'release', null, feed)
      ).toBe(false)
    }
  })

  it('binds internal feeds to the authenticated internal artifact gateway', () => {
    expect(isAllowedProductUpdaterRequest(artifact, null, 'release', null, [], internalFeed)).toBe(
      false
    )
    expect(
      isAllowedProductUpdaterRequest(internalArtifact, null, 'release', null, [], internalFeed)
    ).toBe(true)
  })

  it('never treats a same-origin feed path as installer bytes', () => {
    const feedPathArtifact = `${feed}HiveCode.exe`
    expect(
      isFinalUpdaterArtifactUrl(feedPathArtifact, 'stablyai/orca', 'release', null, feed)
    ).toBe(false)
    expect(
      isFinalUpdaterRedirectArtifactUrl(feedPathArtifact, 'stablyai/orca', 'release', null, feed)
    ).toBe(false)
    expect(isFinalUpdaterArtifactUrl(artifact, 'stablyai/orca', 'release', null, feed)).toBe(true)
  })
})
