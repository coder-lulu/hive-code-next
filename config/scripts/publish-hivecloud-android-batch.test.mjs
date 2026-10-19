import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'

const testRoot = new URL('../../logs/release-batch/tests/', import.meta.url)
mkdirSync(testRoot, { recursive: true })

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.resetModules()
})

it.each(['beta', 'stable'])(
  'uploads and verifies a %s universal APK without exposing a partial batch',
  async (channel) => {
    const root = mkdtempSync(new URL('android-', testRoot))
    try {
      const bytes = Buffer.from('signed APK fixture')
      const apkPath = join(root, 'hivecode.apk')
      writeFileSync(apkPath, bytes)
      const releaseId = '20000000-0000-4000-8000-000000000001'
      const batchId = '10000000-0000-4000-8000-000000000001'
      const artifactId = '30000000-0000-4000-8000-000000000001'
      const release = {
        releaseId,
        productCode: 'hivecode',
        platform: 'ANDROID',
        channel,
        versionName: channel === 'beta' ? '1.5.0-beta.28' : '1.5.0',
        buildNumber: 41,
        status: 'DRAFT',
        artifacts: []
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
      const request = vi.fn(async (url, options) => {
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
          release.artifacts = [
            {
              artifactId,
              architecture: 'UNIVERSAL',
              packageFormat: 'APK',
              distributionType: 'DIRECT',
              sha256: createHash('sha256').update(bytes).digest('hex'),
              sha512: createHash('sha512').update(bytes).digest('hex'),
              fileSize: bytes.length,
              status: 'UPLOADED'
            }
          ]
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
      await main()
      expect(request.mock.calls.some(([url]) => url.endsWith('/verify'))).toBe(true)
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
