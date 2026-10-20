import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const testRoot = new URL('../../logs/release-batch/tests/', import.meta.url)
mkdirSync(testRoot, { recursive: true })

beforeEach(() => {
  vi.stubEnv('GITHUB_ACTIONS', 'false')
  vi.stubEnv('ACTIONS_ID_TOKEN_REQUEST_URL', '')
  vi.stubEnv('ACTIONS_ID_TOKEN_REQUEST_TOKEN', '')
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.resetModules()
})

it.each(
  ['beta', 'stable'].flatMap((channel) =>
    ['UPLOADED', 'VERIFIED', 'REJECTED', 'VERIFIED_WRONG_HASH'].flatMap((status) =>
      [false, true].map((existing) => [channel, status, existing])
    )
  )
)(
  'uploads and verifies a %s universal APK returned as %s (existing=%s) without exposing a partial batch',
  async (channel, status, existing) => {
    const root = mkdtempSync(new URL('android-', testRoot))
    try {
      const bytes = Buffer.from('signed APK fixture')
      const apkPath = join(root, 'hivecode.apk')
      writeFileSync(apkPath, bytes)
      const releaseId = '20000000-0000-4000-8000-000000000001'
      const batchId = '10000000-0000-4000-8000-000000000001'
      const artifactId = '30000000-0000-4000-8000-000000000001'
      const artifact = {
        artifactId,
        architecture: 'UNIVERSAL',
        packageFormat: 'APK',
        distributionType: 'DIRECT',
        sha256: createHash('sha256').update(bytes).digest('hex'),
        sha512: createHash('sha512').update(bytes).digest('hex'),
        fileSize: bytes.length,
        status: status === 'VERIFIED_WRONG_HASH' ? 'VERIFIED' : status
      }
      if (status === 'VERIFIED_WRONG_HASH') {
        artifact.sha256 = '0'.repeat(64)
      }
      const release = {
        releaseId,
        productCode: 'hivecode',
        platform: 'ANDROID',
        channel,
        versionName: channel === 'beta' ? '1.5.0-beta.28' : '1.5.0',
        buildNumber: 41,
        status: 'DRAFT',
        artifacts: existing ? [artifact] : []
      }
      const sourceCommit = 'a'.repeat(40)
      for (const [name, value] of Object.entries({
        HIVECLOUD_API_URL: 'https://api.example.test',
        HIVECLOUD_API_CLIENT_ID: 'release-ci',
        HIVECLOUD_API_TOKEN: 'secret',
        HIVECLOUD_RELEASE_ID: releaseId,
        HIVECLOUD_RELEASE_BATCH_ID: batchId,
        HIVECLOUD_APK_PATH: apkPath,
        HIVECODE_VERSION: release.versionName,
        HIVECODE_RELEASE_CHANNEL: channel,
        HIVECODE_ANDROID_BUILD_NUMBER: '41',
        HIVECODE_COMMIT_SHA: sourceCommit,
        HIVECODE_PUBLISH: 'false',
        HIVECODE_ANDROID_ARCHITECTURE: '',
        HIVECODE_ANDROID_SIGNING_FINGERPRINT: 'ab'.repeat(32),
        HIVECLOUD_RELEASE_ATTESTATION_KEY: Buffer.alloc(32, 7).toString('base64')
      })) {
        vi.stubEnv(name, value)
      }
      const timeoutDurations = new Map()
      const timeout = AbortSignal.timeout.bind(AbortSignal)
      vi.spyOn(AbortSignal, 'timeout').mockImplementation((milliseconds) => {
        const signal = timeout(milliseconds)
        timeoutDurations.set(signal, milliseconds)
        return signal
      })
      const request = vi.fn(async (url, options) => {
        expect(timeoutDurations.get(options.signal)).toBe(
          options.body instanceof FormData ? 600_000 : 60_000
        )
        expect(options.headers?.clientid).toBe(
          url.includes('/hive/v1/admin/') ? 'release-ci' : undefined
        )
        if (!url.includes('/hive/v1/admin/')) {
          expect(options.headers?.authorization).toBeUndefined()
        }
        if (url.includes('/release-batches/')) {
          return Response.json({
            batchId,
            productCode: 'hivecode',
            channel,
            versionName: release.versionName,
            sourceCommit,
            status: 'DRAFT',
            releases: [{ releaseId, platform: 'ANDROID', buildNumber: 41 }]
          })
        }
        if (url.endsWith('/artifacts')) {
          expect(options.body.get('architecture')).toBe('universal')
          expect(Buffer.from(await options.body.get('file').arrayBuffer())).toEqual(bytes)
          release.artifacts = [artifact]
        }
        if (url.endsWith('/verify')) {
          expect(JSON.parse(options.body).verificationEvidence).toContain(
            '.android.android-apksigner.'
          )
          release.artifacts[0].status = 'VERIFIED'
        }
        return Response.json(release)
      })
      vi.stubGlobal('fetch', request)
      vi.spyOn(console, 'log').mockImplementation(() => {})
      const { main } = await import('../../mobile/scripts/publish-hivecloud-release.mjs')
      if (status === 'REJECTED' || status === 'VERIFIED_WRONG_HASH') {
        await expect(main()).rejects.toThrow(
          status === 'REJECTED'
            ? 'artifact is not verifiable'
            : existing
              ? 'different artifact'
              : 'did not identify exactly one uploaded artifact'
        )
        expect(
          request.mock.calls.some(([url]) => url.endsWith('/verify') || url.endsWith('/publish'))
        ).toBe(false)
        expect(request.mock.calls.filter(([url]) => url.endsWith('/artifacts'))).toHaveLength(
          existing ? 0 : 1
        )
        return
      }
      await main()
      expect(request.mock.calls.filter(([url]) => url.endsWith('/artifacts'))).toHaveLength(
        existing ? 0 : 1
      )
      expect(request.mock.calls.filter(([url]) => url.endsWith('/verify'))).toHaveLength(
        status === 'UPLOADED' ? 1 : 0
      )
      expect(
        request.mock.calls.some(
          ([url]) => url.endsWith('/publish') || url.includes('/updates/check')
        )
      ).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }
)

it('rejects missing client identity before uploading any artifact', async () => {
  vi.stubEnv('HIVECLOUD_API_URL', 'https://api.example.test')
  vi.stubEnv('HIVECLOUD_API_TOKEN', 'secret')
  vi.stubEnv('HIVECLOUD_API_CLIENT_ID', ' ')
  const request = vi.fn()
  vi.stubGlobal('fetch', request)
  const { main } = await import('../../mobile/scripts/publish-hivecloud-release.mjs')
  await expect(main()).rejects.toThrow('HIVECLOUD_API_CLIENT_ID')
  expect(request).not.toHaveBeenCalled()
})
