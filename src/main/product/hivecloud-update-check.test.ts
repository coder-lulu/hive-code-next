import { describe, expect, it } from 'vitest'
import {
  fetchHiveCloudUpdateDecision,
  parseHiveCloudUpdateDecision
} from './hivecloud-update-check'

const latest = {
  versionName: '1.5.0-beta.1',
  buildNumber: 14,
  releaseNotes: 'notes',
  mandatory: false,
  publishedAt: '2026-08-30T00:00:00Z',
  artifact: {
    packageFormat: 'apk',
    architecture: 'arm64_v8a',
    distributionType: 'direct',
    downloadUrl:
      'https://updates.hive.test/hive/v1/update-artifacts/4f1f7c54-06f2-4a22-b4a9-26c9c9b0c3f5/download',
    storeUrl: null,
    sha256: 'a'.repeat(64),
    sha512: 'b'.repeat(128),
    size: 123
  }
}

describe('HiveCloud update check contract', () => {
  it('parses a mandatory/update response', () => {
    expect(
      parseHiveCloudUpdateDecision({
        hasUpdate: true,
        updateRequired: true,
        blockReason: 'below_min_supported_build',
        currentBuild: 13,
        minimumSupportedBuild: 14,
        latest
      })?.latest?.versionName
    ).toBe('1.5.0-beta.1')
  })

  it('rejects malformed mandatory responses', () => {
    expect(
      parseHiveCloudUpdateDecision({
        hasUpdate: false,
        updateRequired: true,
        currentBuild: 1,
        latest: null
      })
    ).toBeNull()
  })

  it('rejects oversized version and block-reason fields', () => {
    expect(
      parseHiveCloudUpdateDecision({
        hasUpdate: true,
        updateRequired: false,
        currentBuild: 13,
        latest: {
          ...latest,
          versionName: `1.5.0-beta.${'1'.repeat(60)}`
        }
      })
    ).toBeNull()
    expect(
      parseHiveCloudUpdateDecision({
        hasUpdate: false,
        updateRequired: false,
        currentBuild: 13,
        latest: null,
        blockReason: 'x'.repeat(257)
      })
    ).toBeNull()
  })

  it('accepts the unified top-level artifact while retaining the legacy nested shape', () => {
    const parsed = parseHiveCloudUpdateDecision({
      hasUpdate: true,
      updateRequired: false,
      currentBuild: 13,
      minimumSupportedBuild: null,
      latest: {
        versionName: '1.5.0-beta.1',
        buildNumber: 14,
        releaseNotes: '',
        mandatory: false,
        publishedAt: '2026-08-30T00:00:00Z',
        artifact: null
      },
      artifact: {
        packageFormat: 'APK',
        architecture: 'arm64_v8a',
        distribution: 'DIRECT',
        downloadUrl:
          'https://updates.hive.test/hive/v1/update-artifacts/4f1f7c54-06f2-4a22-b4a9-26c9c9b0c3f5/download',
        storeUrl: null,
        sha256: 'a'.repeat(64),
        size: 123
      }
    })
    expect(parsed?.artifact?.distributionType).toBe('DIRECT')
    expect(parsed?.latest?.artifact?.downloadUrl).toContain('/hive/v1/update-artifacts/')
  })

  it('rejects conflicting explicit top-level and nested artifacts', () => {
    expect(
      parseHiveCloudUpdateDecision({
        hasUpdate: true,
        updateRequired: false,
        currentBuild: 13,
        minimumSupportedBuild: null,
        latest: {
          versionName: '1.5.0-beta.1',
          buildNumber: 14,
          releaseNotes: '',
          mandatory: false,
          publishedAt: '2026-08-30T00:00:00Z',
          artifact: { ...latest.artifact, downloadUrl: `${latest.artifact.downloadUrl}?other=1` }
        },
        artifact: latest.artifact
      })
    ).toBeNull()
  })

  it('keeps a mandatory latest annotation when this client is already current', () => {
    expect(
      parseHiveCloudUpdateDecision({
        hasUpdate: false,
        updateRequired: false,
        currentBuild: 13,
        minimumSupportedBuild: null,
        latest: { ...latest, mandatory: true },
        artifact: null
      })
    ).toMatchObject({ hasUpdate: false, latest: { mandatory: true } })
  })

  it('sends the complete query contract', async () => {
    const fetchImpl = async (input: RequestInfo | URL) => {
      const requestUrl = new URL(String(input))
      expect(requestUrl.searchParams.get('currentBuild')).toBe('13')
      expect(requestUrl.searchParams.get('platform')).toBe('android')
      return new Response(
        JSON.stringify({
          hasUpdate: false,
          updateRequired: false,
          blockReason: null,
          currentBuild: 13,
          minimumSupportedBuild: null,
          latest: null
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    }
    await expect(
      fetchHiveCloudUpdateDecision({
        endpoint: 'https://updates.hive.test/hive/v1/updates/check',
        product: 'hivecode',
        platform: 'android',
        architecture: 'arm64_v8a',
        channel: 'beta',
        currentVersion: '1.5.0-beta.1',
        currentBuild: 13,
        fetchImpl
      })
    ).resolves.toMatchObject({ hasUpdate: false })
  })

  it('rejects an insecure HiveCloud endpoint before making a request', async () => {
    const fetchImpl = async () => {
      throw new Error('fetch should not be called')
    }
    await expect(
      fetchHiveCloudUpdateDecision({
        endpoint: 'http://updates.hive.test/hive/v1/updates/check',
        product: 'hivecode',
        platform: 'android',
        architecture: 'arm64_v8a',
        channel: 'beta',
        currentVersion: '1.5.0-beta.1',
        currentBuild: 13,
        fetchImpl
      })
    ).rejects.toThrow('HTTPS')
  })

  it('rejects an invalid current version before making a request', async () => {
    const fetchImpl = async () => {
      throw new Error('fetch should not be called')
    }
    await expect(
      fetchHiveCloudUpdateDecision({
        endpoint: 'https://updates.hive.test/hive/v1/updates/check',
        product: 'hivecode',
        platform: 'android',
        architecture: 'arm64_v8a',
        channel: 'beta',
        currentVersion: '1.5',
        currentBuild: 13,
        fetchImpl
      })
    ).rejects.toThrow('invalid identity')
  })

  it.each([
    'https://updates.hive.test/hive/v1/updates/check/',
    'https://updates.hive.test/hive/v1/updates/proxy-check',
    'https://updates.hive.test/hive/v1/updates/%63heck'
  ])(
    'rejects a non-canonical HiveCloud check path before making a request: %s',
    async (endpoint) => {
      const fetchImpl = async () => {
        throw new Error('fetch should not be called')
      }
      await expect(
        fetchHiveCloudUpdateDecision({
          endpoint,
          product: 'hivecode',
          platform: 'android',
          architecture: 'arm64_v8a',
          channel: 'beta',
          currentVersion: '1.5.0-beta.1',
          currentBuild: 13,
          fetchImpl
        })
      ).rejects.toThrow('HTTPS')
    }
  )

  it('rejects a control-plane response that points at a foreign download host', async () => {
    const fetchImpl = async () =>
      new Response(
        JSON.stringify({
          hasUpdate: true,
          updateRequired: false,
          currentBuild: 13,
          minimumSupportedBuild: null,
          latest: {
            ...latest,
            artifact: { ...latest.artifact, downloadUrl: 'https://evil.test/app.zip' }
          }
        }),
        { status: 200 }
      )
    await expect(
      fetchHiveCloudUpdateDecision({
        endpoint: 'https://updates.hive.test/hive/v1/updates/check',
        product: 'hivecode',
        platform: 'android',
        architecture: 'arm64_v8a',
        channel: 'beta',
        currentVersion: '1.5.0-beta.1',
        currentBuild: 13,
        fetchImpl
      })
    ).rejects.toThrow('object-storage gateway')
  })

  it('rejects a response that hides a newer mandatory release', async () => {
    const fetchImpl = async () =>
      new Response(
        JSON.stringify({
          hasUpdate: false,
          updateRequired: false,
          currentBuild: 13,
          minimumSupportedBuild: null,
          latest: { ...latest, mandatory: true }
        }),
        { status: 200 }
      )
    await expect(
      fetchHiveCloudUpdateDecision({
        endpoint: 'https://updates.hive.test/hive/v1/updates/check',
        product: 'hivecode',
        platform: 'android',
        architecture: 'arm64_v8a',
        channel: 'beta',
        currentVersion: '1.4.178-rc.7',
        currentBuild: 13,
        fetchImpl
      })
    ).rejects.toThrow('mandatory newer')
  })

  it('rejects a direct artifact without integrity evidence', async () => {
    const fetchImpl = async () =>
      new Response(
        JSON.stringify({
          hasUpdate: true,
          updateRequired: false,
          currentBuild: 13,
          minimumSupportedBuild: null,
          latest: {
            ...latest,
            artifact: { ...latest.artifact, sha256: null }
          }
        }),
        { status: 200 }
      )
    await expect(
      fetchHiveCloudUpdateDecision({
        endpoint: 'https://updates.hive.test/hive/v1/updates/check',
        product: 'hivecode',
        platform: 'android',
        architecture: 'arm64_v8a',
        channel: 'beta',
        currentVersion: '1.5.0-beta.1',
        currentBuild: 13,
        fetchImpl
      })
    ).rejects.toThrow('incomplete artifact')
  })

  it('rejects a direct artifact that also carries a store link', async () => {
    const fetchImpl = async () =>
      new Response(
        JSON.stringify({
          hasUpdate: true,
          updateRequired: false,
          currentBuild: 13,
          minimumSupportedBuild: null,
          latest: {
            ...latest,
            artifact: {
              ...latest.artifact,
              storeUrl: 'https://testflight.apple.com/join/abcdef'
            }
          }
        }),
        { status: 200 }
      )
    await expect(
      fetchHiveCloudUpdateDecision({
        endpoint: 'https://updates.hive.test/hive/v1/updates/check',
        product: 'hivecode',
        platform: 'android',
        architecture: 'arm64_v8a',
        channel: 'beta',
        currentVersion: '1.5.0-beta.1',
        currentBuild: 13,
        fetchImpl
      })
    ).rejects.toThrow('incomplete artifact')
  })

  it('binds iOS store hosts and distributions to the requested channel', async () => {
    const storeArtifact = {
      packageFormat: 'store_link',
      architecture: 'universal',
      distributionType: 'testflight',
      downloadUrl: null,
      storeUrl: 'https://testflight.apple.com/join/abcdef',
      sha256: null,
      sha512: null,
      size: null
    }
    const fetchStoreRelease = (artifact: typeof storeArtifact) => async () =>
      new Response(
        JSON.stringify({
          hasUpdate: true,
          updateRequired: false,
          currentBuild: 1,
          minimumSupportedBuild: null,
          latest: {
            ...latest,
            buildNumber: 2,
            artifact
          }
        }),
        { status: 200 }
      )

    await expect(
      fetchHiveCloudUpdateDecision({
        endpoint: 'https://updates.hive.test/hive/v1/updates/check',
        product: 'hivecode',
        platform: 'ios',
        architecture: 'arm64',
        channel: 'beta',
        currentVersion: '1.4.178-rc.7',
        currentBuild: 1,
        fetchImpl: fetchStoreRelease(storeArtifact)
      })
    ).resolves.toMatchObject({ latest: { artifact: { distributionType: 'testflight' } } })

    await expect(
      fetchHiveCloudUpdateDecision({
        endpoint: 'https://updates.hive.test/hive/v1/updates/check',
        product: 'hivecode',
        platform: 'ios',
        architecture: 'arm64',
        channel: 'beta',
        currentVersion: '1.4.178-rc.7',
        currentBuild: 1,
        fetchImpl: fetchStoreRelease({
          ...storeArtifact,
          distributionType: 'app_store',
          storeUrl: 'https://apps.apple.com/us/app/hivecode/id123'
        })
      })
    ).rejects.toThrow('invalid store link')

    await expect(
      fetchHiveCloudUpdateDecision({
        endpoint: 'https://updates.hive.test/hive/v1/updates/check',
        product: 'hivecode',
        platform: 'ios',
        architecture: 'arm64',
        channel: 'stable',
        currentVersion: '1.4.178-rc.7',
        currentBuild: 1,
        fetchImpl: fetchStoreRelease({
          ...storeArtifact,
          distributionType: 'app_store',
          storeUrl: 'https://testflight.apple.com/join/abcdef'
        })
      })
    ).rejects.toThrow('invalid store link')
  })

  it('rejects iOS store artifacts with ignored direct-download fields', async () => {
    const fetchImpl = async () =>
      new Response(
        JSON.stringify({
          hasUpdate: true,
          updateRequired: false,
          currentBuild: 1,
          minimumSupportedBuild: null,
          latest: {
            ...latest,
            buildNumber: 2,
            artifact: {
              packageFormat: 'store_link',
              architecture: 'universal',
              distributionType: 'testflight',
              downloadUrl:
                'https://updates.hive.test/hive/v1/update-artifacts/4f1f7c54-06f2-4a22-b4a9-26c9c9b0c3f5/download',
              storeUrl: 'https://testflight.apple.com/join/abcdef',
              sha256: 'a'.repeat(64),
              sha512: 'b'.repeat(128),
              size: 123
            }
          }
        }),
        { status: 200 }
      )
    await expect(
      fetchHiveCloudUpdateDecision({
        endpoint: 'https://updates.hive.test/hive/v1/updates/check',
        product: 'hivecode',
        platform: 'ios',
        architecture: 'arm64',
        channel: 'beta',
        currentVersion: '1.4.178-rc.7',
        currentBuild: 1,
        fetchImpl
      })
    ).rejects.toThrow('invalid store link')
  })

  it('accepts only the platform-specific desktop installer format', async () => {
    const fetchImpl = async () =>
      new Response(
        JSON.stringify({
          hasUpdate: true,
          updateRequired: false,
          currentBuild: 1,
          minimumSupportedBuild: null,
          latest: {
            ...latest,
            versionName: '1.5.0-beta.1',
            buildNumber: 2,
            artifact: {
              ...latest.artifact,
              packageFormat: 'nsis',
              architecture: 'x64',
              downloadUrl:
                'https://updates.hive.test/hive/v1/update-artifacts/4f1f7c54-06f2-4a22-b4a9-26c9c9b0c3f5/download'
            }
          }
        }),
        { status: 200 }
      )
    await expect(
      fetchHiveCloudUpdateDecision({
        endpoint: 'https://updates.hive.test/hive/v1/updates/check',
        product: 'hivecode',
        platform: 'windows',
        architecture: 'x64',
        channel: 'beta',
        currentVersion: '1.4.178-rc.7',
        currentBuild: 1,
        fetchImpl
      })
    ).resolves.toMatchObject({ latest: { artifact: { packageFormat: 'nsis' } } })
  })

  it('rejects a desktop response with an Android package format', async () => {
    const fetchImpl = async () =>
      new Response(
        JSON.stringify({
          hasUpdate: true,
          updateRequired: false,
          currentBuild: 1,
          minimumSupportedBuild: null,
          latest: {
            ...latest,
            versionName: '1.5.0-beta.1',
            buildNumber: 2,
            artifact: { ...latest.artifact, packageFormat: 'apk', architecture: 'x64' }
          }
        }),
        { status: 200 }
      )
    await expect(
      fetchHiveCloudUpdateDecision({
        endpoint: 'https://updates.hive.test/hive/v1/updates/check',
        product: 'hivecode',
        platform: 'windows',
        architecture: 'x64',
        channel: 'beta',
        currentVersion: '1.4.178-rc.7',
        currentBuild: 1,
        fetchImpl
      })
    ).rejects.toThrow('package format')
  })

  it('rejects an update that omits its immutable artifact', async () => {
    const fetchImpl = async () =>
      new Response(
        JSON.stringify({
          hasUpdate: true,
          updateRequired: false,
          currentBuild: 1,
          minimumSupportedBuild: null,
          latest: {
            versionName: '1.5.0-beta.1',
            buildNumber: 2,
            releaseNotes: '',
            mandatory: false,
            publishedAt: '2026-08-30T00:00:00Z',
            artifact: null
          }
        }),
        { status: 200 }
      )
    await expect(
      fetchHiveCloudUpdateDecision({
        endpoint: 'https://updates.hive.test/hive/v1/updates/check',
        product: 'hivecode',
        platform: 'windows',
        architecture: 'x64',
        channel: 'beta',
        currentVersion: '1.4.178-rc.7',
        currentBuild: 1,
        fetchImpl
      })
    ).rejects.toThrow('missing the update artifact')
  })

  it('rejects a newer version that reuses an older build number', async () => {
    const fetchImpl = async () =>
      new Response(
        JSON.stringify({
          hasUpdate: true,
          updateRequired: false,
          currentBuild: 13,
          minimumSupportedBuild: null,
          latest: {
            ...latest,
            buildNumber: 12
          }
        }),
        { status: 200 }
      )
    await expect(
      fetchHiveCloudUpdateDecision({
        endpoint: 'https://updates.hive.test/hive/v1/updates/check',
        product: 'hivecode',
        platform: 'android',
        architecture: 'arm64_v8a',
        channel: 'beta',
        currentVersion: '1.4.178-rc.7',
        currentBuild: 13,
        fetchImpl
      })
    ).rejects.toThrow('stale build')
  })
})
