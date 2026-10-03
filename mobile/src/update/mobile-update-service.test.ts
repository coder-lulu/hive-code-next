import { describe, expect, it, vi } from 'vitest'
import AsyncStorage from '@react-native-async-storage/async-storage'
import Constants from 'expo-constants'
import {
  downloadVerifiedApk,
  openApkInstaller,
  requestApkInstallPermission
} from '@hivecode/expo-hivecode-updater'

vi.mock('../generated/product-config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../generated/product-config')>()
  return {
    hivecodeProductConfig: {
      ...actual.hivecodeProductConfig,
      services: {
        ...actual.hivecodeProductConfig.services,
        update: {
          ...actual.hivecodeProductConfig.services.update,
          checkEndpoint: 'https://updates.hive.test/hive/v1/updates/check'
        }
      }
    }
  }
})
vi.mock('react-native', () => ({
  AppState: { currentState: 'active' },
  Linking: { openURL: vi.fn(), canOpenURL: vi.fn() },
  Platform: { OS: 'android', constants: { Architecture: 'arm64-v8a' } }
}))
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: vi.fn(), setItem: vi.fn() }
}))
vi.mock('expo-constants', () => ({
  default: { expoConfig: { version: '1.5.0-beta.1', android: { versionCode: 14 } } }
}))
vi.mock('@hivecode/expo-hivecode-updater', () => ({
  hasApkInstallPermission: vi.fn().mockResolvedValue(true),
  subscribeApkDownloadProgress: vi.fn(() => () => {}),
  deleteDownloadedApk: vi.fn(),
  downloadVerifiedApk: vi.fn(),
  openApkInstaller: vi.fn(),
  requestApkInstallPermission: vi.fn()
}))
import {
  assertMobileUpdateArtifact,
  checkMobileUpdate,
  downloadAndInstallAndroidUpdate,
  getMobileUpdateSnapshot,
  normalizeAndroidArchitecture,
  parseMobileUpdateDecision
} from './mobile-update-service'

const androidArtifact = {
  packageFormat: 'apk',
  distributionType: 'direct',
  downloadUrl:
    'https://updates.hive.test/hive/v1/update-artifacts/4f1f7c54-06f2-4a22-b4a9-26c9c9b0c3f5/download',
  storeUrl: null,
  sha256: 'a'.repeat(64),
  size: 12
}
const latestRelease = {
  versionName: '1.5.0-beta.1',
  buildNumber: 15,
  releaseNotes: '',
  mandatory: false,
  artifact: androidArtifact
}

describe('mobile update contract', () => {
  it('normalizes common Android ABI aliases to the HiveCloud enum', () => {
    expect(normalizeAndroidArchitecture('arm64-v8a')).toBe('arm64_v8a')
    expect(normalizeAndroidArchitecture('arm64')).toBe('arm64_v8a')
    expect(normalizeAndroidArchitecture('armeabi-v7a')).toBe('armeabi_v7a')
    expect(normalizeAndroidArchitecture('x86_64')).toBe('x86_64')
  })

  it('parses mandatory Android responses and validates the direct APK artifact', () => {
    const decision = parseMobileUpdateDecision({
      hasUpdate: true,
      updateRequired: true,
      currentBuild: 14,
      minimumSupportedBuild: 14,
      latest: {
        versionName: '1.5.0-beta.1',
        buildNumber: 14,
        releaseNotes: '重要修复',
        mandatory: true,
        artifact: androidArtifact
      }
    })

    expect(decision?.updateRequired).toBe(true)
    expect(decision?.latest?.mandatory).toBe(true)
    expect(assertMobileUpdateArtifact(decision?.latest?.artifact ?? null, 'android')).toEqual(
      androidArtifact
    )
  })

  it('rejects non-HTTPS or non-direct Android artifacts', () => {
    expect(() =>
      assertMobileUpdateArtifact(
        {
          ...androidArtifact,
          downloadUrl: 'http://updates.hive.test/hive.apk'
        },
        'android'
      )
    ).toThrow()
    expect(() =>
      assertMobileUpdateArtifact(
        {
          packageFormat: 'store_link',
          distributionType: 'app_store',
          downloadUrl: null,
          storeUrl: 'https://user:password@apps.apple.com/us/app/hivecode/id123',
          sha256: null,
          size: null
        },
        'ios'
      )
    ).toThrow()
    expect(() =>
      assertMobileUpdateArtifact(
        {
          ...androidArtifact,
          distributionType: 'app_store'
        },
        'android'
      )
    ).toThrow()
  })

  it('rejects an artifact hosted outside the configured HiveCloud origin', () => {
    expect(() =>
      assertMobileUpdateArtifact(androidArtifact, 'android', 'https://updates.hive.test')
    ).not.toThrow()
    expect(() =>
      assertMobileUpdateArtifact(androidArtifact, 'android', 'https://objects.example.test')
    ).toThrow('object-storage gateway')
  })

  it('accepts iOS store links and rejects malformed responses', () => {
    expect(
      assertMobileUpdateArtifact(
        {
          packageFormat: 'store_link',
          distributionType: 'testflight',
          downloadUrl: null,
          storeUrl: 'https://testflight.apple.com/join/abcdef',
          sha256: null,
          size: null
        },
        'ios'
      ).storeUrl
    ).toContain('testflight.apple.com')
    expect(() =>
      parseMobileUpdateDecision({ hasUpdate: false, updateRequired: true, latest: null })
    ).toThrow()
    expect(() =>
      parseMobileUpdateDecision({
        hasUpdate: true,
        updateRequired: false,
        latest: {
          versionName: 'v1.5.0',
          buildNumber: 15,
          releaseNotes: '',
          artifact: androidArtifact
        }
      })
    ).toThrow()
    expect(() =>
      assertMobileUpdateArtifact(
        {
          packageFormat: 'store_link',
          distributionType: 'app_store',
          downloadUrl: null,
          storeUrl: 'https://apps.apple.com:444/app/hivecode/id123',
          sha256: null,
          size: null
        },
        'ios'
      )
    ).toThrow()
    expect(() =>
      assertMobileUpdateArtifact(
        {
          packageFormat: 'store_link',
          distributionType: 'app_store',
          downloadUrl: null,
          storeUrl: 'https://apps.apple.com/us/app/hivecode/id123?mt=8',
          sha256: null,
          size: null
        },
        'ios'
      )
    ).toThrow()
  })

  it('binds iOS store distributions and hosts to the update channel', () => {
    const testFlightArtifact = {
      packageFormat: 'store_link',
      distributionType: 'testflight',
      downloadUrl: null,
      storeUrl: 'https://testflight.apple.com/join/abcdef',
      sha256: null,
      size: null
    }
    const appStoreArtifact = {
      ...testFlightArtifact,
      distributionType: 'app_store',
      storeUrl: 'https://apps.apple.com/us/app/hivecode/id123'
    }

    expect(() => assertMobileUpdateArtifact(testFlightArtifact, 'ios', null, 'beta')).not.toThrow()
    expect(() => assertMobileUpdateArtifact(appStoreArtifact, 'ios', null, 'stable')).not.toThrow()
    expect(() => assertMobileUpdateArtifact(appStoreArtifact, 'ios', null, 'beta')).toThrow()
    expect(() =>
      assertMobileUpdateArtifact(
        { ...testFlightArtifact, distributionType: 'app_store' },
        'ios',
        null,
        'internal'
      )
    ).toThrow()
  })

  it('rejects oversized update metadata before it reaches the UI or downloader', () => {
    expect(() =>
      assertMobileUpdateArtifact(
        {
          ...androidArtifact,
          downloadUrl: `https://updates.hive.test/${'x'.repeat(2048)}`
        },
        'android'
      )
    ).toThrow()
    expect(() =>
      parseMobileUpdateDecision({
        hasUpdate: true,
        updateRequired: false,
        currentBuild: 14,
        minimumSupportedBuild: null,
        latest: {
          ...latestRelease,
          releaseNotes: 'x'.repeat(64 * 1024 + 1)
        }
      })
    ).toThrow('latest update response')
  })

  it('requires the server to echo the current build in every response', () => {
    expect(() =>
      parseMobileUpdateDecision({
        hasUpdate: false,
        updateRequired: false,
        minimumSupportedBuild: null,
        latest: null
      })
    ).toThrow('current build')
    expect(() =>
      parseMobileUpdateDecision({
        hasUpdate: false,
        updateRequired: false,
        minimumSupportedBuild: null,
        currentBuild: 0,
        latest: null
      })
    ).toThrow('current build')
  })

  it('accepts the unified top-level Android artifact shape', () => {
    const decision = parseMobileUpdateDecision({
      hasUpdate: true,
      updateRequired: false,
      currentBuild: 14,
      minimumSupportedBuild: null,
      latest: {
        versionName: '1.5.0-beta.1',
        buildNumber: 15,
        releaseNotes: '',
        mandatory: false,
        artifact: null
      },
      artifact: {
        ...androidArtifact,
        distributionType: undefined,
        distribution: 'direct'
      }
    })
    expect(decision.latest?.artifact?.distributionType).toBe('direct')
  })

  it('rejects conflicting explicit top-level and nested artifacts', () => {
    expect(() =>
      parseMobileUpdateDecision({
        hasUpdate: true,
        updateRequired: false,
        currentBuild: 14,
        minimumSupportedBuild: null,
        latest: {
          versionName: '1.5.0-beta.1',
          buildNumber: 15,
          releaseNotes: '',
          mandatory: false,
          artifact: { ...androidArtifact, sha256: 'b'.repeat(64) }
        },
        artifact: androidArtifact
      })
    ).toThrow('Conflicting update artifacts')
  })

  it('keeps a mandatory latest annotation when this client is already current', () => {
    expect(() =>
      parseMobileUpdateDecision({
        hasUpdate: false,
        updateRequired: false,
        currentBuild: 13,
        minimumSupportedBuild: null,
        latest: { ...latestRelease, mandatory: true },
        artifact: null
      })
    ).not.toThrow()
    expect(
      parseMobileUpdateDecision({
        hasUpdate: false,
        updateRequired: false,
        currentBuild: 13,
        minimumSupportedBuild: null,
        latest: { ...latestRelease, mandatory: true },
        artifact: null
      })?.latest?.mandatory
    ).toBe(true)
  })

  it('does not silently accept a mandatory response with an older product version', async () => {
    const result = await checkMobileUpdate({
      force: true,
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            hasUpdate: true,
            updateRequired: true,
            currentBuild: 14,
            minimumSupportedBuild: 14,
            latest: {
              versionName: '1.4.178-rc.7',
              buildNumber: 99,
              releaseNotes: 'stale',
              mandatory: true,
              artifact: androidArtifact
            }
          }),
          { status: 200 }
        )
    })

    expect(result.state).toBe('error')
    expect(result.message).toContain('过期版本')
    expect(getMobileUpdateSnapshot().state).toBe('error')
  })

  it('rejects a response that hides a newer mandatory release', async () => {
    const result = await checkMobileUpdate({
      force: true,
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            hasUpdate: false,
            updateRequired: false,
            currentBuild: 14,
            minimumSupportedBuild: 14,
            latest: { ...latestRelease, mandatory: true }
          }),
          { status: 200 }
        )
    })
    expect(result.state).toBe('error')
    expect(result.message).toContain('隐藏了较新的强制版本')
  })

  it('keeps an old cached mandatory policy when legacy version metadata is malformed', async () => {
    const originalVersion = Constants.expoConfig?.version
    const cachedDecision = {
      hasUpdate: true,
      updateRequired: true,
      currentBuild: 14,
      minimumSupportedBuild: 14,
      latest: {
        ...latestRelease,
        buildNumber: 15,
        mandatory: true
      }
    }
    vi.mocked(AsyncStorage.getItem).mockResolvedValue(null)
    await checkMobileUpdate({
      force: true,
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            hasUpdate: false,
            updateRequired: false,
            currentBuild: 14,
            minimumSupportedBuild: null,
            latest: null
          }),
          { status: 200 }
        )
    })
    vi.mocked(AsyncStorage.getItem).mockImplementation(async (key) =>
      key.includes('decision')
        ? JSON.stringify({
            decision: cachedDecision,
            checkedAt: Date.now() - 30 * 24 * 60 * 60 * 1000
          })
        : null
    )
    if (Constants.expoConfig) {
      Constants.expoConfig.version = '0.0'
    }
    try {
      const result = await checkMobileUpdate({
        force: true,
        fetchImpl: async () => {
          throw new Error('offline')
        }
      })
      expect(result.state).toBe('error')
      expect(result.mandatory).toBe(true)
      expect(result.buildNumber).toBe(15)
    } finally {
      if (Constants.expoConfig) {
        Constants.expoConfig.version = originalVersion
      }
      vi.mocked(AsyncStorage.getItem).mockReset()
    }
  })

  it('delegates bounded redirect-proof APK download and verification to the native bridge', async () => {
    vi.mocked(requestApkInstallPermission).mockResolvedValue(true)
    vi.mocked(downloadVerifiedApk).mockResolvedValue(
      'content://test.hivecode.hivecode.updater.files/update_apks/hivecode-update-1.apk'
    )
    vi.mocked(openApkInstaller).mockResolvedValue()
    await checkMobileUpdate({
      force: true,
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            hasUpdate: true,
            updateRequired: false,
            currentBuild: 14,
            minimumSupportedBuild: null,
            latest: latestRelease
          }),
          { status: 200 }
        )
    })

    const result = await downloadAndInstallAndroidUpdate()

    expect(result.state).toBe('ready-to-install')
    expect(downloadVerifiedApk).toHaveBeenCalledWith({
      downloadUrl: androidArtifact.downloadUrl,
      allowedOrigin: 'https://updates.hive.test',
      allowedCdnOrigin: 'https://oss.cloud.hivekernel.com',
      expectedSize: 12,
      expectedSha256: 'a'.repeat(64)
    })
    expect(openApkInstaller).toHaveBeenCalledOnce()
  })
})
