import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.resetModules()
})

it('uploads, verifies and publishes an unsigned Windows installer without a certificate', async () => {
  const root = mkdtempSync(join(tmpdir(), 'hive-unsigned-publish-'))
  try {
    const path = join(root, 'hivecode.exe')
    const bytes = Buffer.from('MZ unsigned installer fixture')
    writeFileSync(path, bytes)
    const releaseId = '20000000-0000-4000-8000-000000000002'
    const artifactId = '40000000-0000-4000-8000-000000000004'
    const artifact = {
      artifactId,
      architecture: 'x64',
      packageFormat: 'NSIS',
      distributionType: 'DIRECT',
      sha256: createHash('sha256').update(bytes).digest('hex'),
      sha512: createHash('sha512').update(bytes).digest('hex'),
      fileSize: bytes.length,
      size: bytes.length,
      status: 'VERIFIED'
    }
    const release = {
      releaseId,
      productCode: 'hivecode',
      platform: 'windows',
      channel: 'beta',
      versionName: '1.5.0-beta.3',
      buildNumber: 3,
      status: 'DRAFT',
      artifacts: []
    }
    for (const [key, value] of Object.entries({
      HIVECLOUD_API_URL: 'https://releases.example.test',
      HIVECLOUD_API_TOKEN: 'test-token',
      HIVECLOUD_RELEASE_ID: releaseId,
      HIVECODE_VERSION: release.versionName,
      HIVECODE_BUILD_NUMBER: '3',
      HIVECODE_DESKTOP_PLATFORM: 'windows',
      HIVECODE_DESKTOP_ARCHITECTURE: 'x64',
      HIVECODE_RELEASE_CHANNEL: 'beta',
      HIVECODE_SIGNING_CERTIFICATE_FINGERPRINT: '',
      HIVECODE_ARTIFACT_PATHS: path,
      HIVECLOUD_RELEASE_ATTESTATION_KEY: Buffer.alloc(32, 7).toString('base64'),
      HIVECODE_PUBLISH: 'true',
      HIVECODE_EXPECTED_ARTIFACTS: '1',
      HIVECODE_EXPECTED_ARTIFACT_ARCHITECTURES: 'x64'
    })) {
      vi.stubEnv(key, value)
    }
    const requests = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url, options) => {
        requests.push(url)
        if (url.endsWith('/artifacts')) {
          expect(options.body.has('signingCertificateFingerprint')).toBe(false)
          expect(Buffer.from(await options.body.get('file').arrayBuffer())).toEqual(bytes)
          release.artifacts = [artifact]
        }
        if (url.endsWith('/verify')) {
          expect(JSON.parse(options.body).verificationEvidence).toContain(
            '.none.windows.windows-hash.'
          )
        }
        return Response.json(
          url.includes('/updates/check?') ? { hasUpdate: true, latest: release, artifact } : release
        )
      })
    )
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const { main } = await import('./publish-hivecloud-desktop-release.mjs')
    await main()
    expect(requests.some((url) => url.endsWith('/verify'))).toBe(true)
    expect(requests.some((url) => url.endsWith('/publish'))).toBe(true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
