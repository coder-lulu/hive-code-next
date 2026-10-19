import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'

const testRoot = new URL('../../logs/headless-install/', import.meta.url)
mkdirSync(testRoot, { recursive: true })

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.resetModules()
})

it.each(['windows', 'macos'])(
  'uploads, verifies and publishes a %s single-format release',
  async (platform) => {
    const root = mkdtempSync(new URL('hive-unsigned-publish-', testRoot))
    try {
      const path = join(root, platform === 'windows' ? 'hivecode.exe' : 'hivecode.zip')
      const fingerprint = platform === 'macos' ? 'ab'.repeat(32) : ''
      const bytes = Buffer.from('MZ unsigned installer fixture')
      writeFileSync(path, bytes)
      const releaseId = '20000000-0000-4000-8000-000000000002'
      const artifactId = '40000000-0000-4000-8000-000000000004'
      const artifact = {
        artifactId,
        architecture: 'x64',
        packageFormat: platform === 'windows' ? 'NSIS' : 'ZIP',
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
        platform,
        channel: 'beta',
        versionName: '1.5.0-beta.3',
        buildNumber: 3,
        status: 'DRAFT',
        artifacts: []
      }
      for (const [key, value] of Object.entries({
        HIVECLOUD_API_URL: 'https://releases.example.test',
        HIVECLOUD_API_CLIENT_ID: 'release-ci',
        HIVECLOUD_API_TOKEN: 'test-token',
        HIVECLOUD_RELEASE_ID: releaseId,
        HIVECODE_VERSION: release.versionName,
        HIVECODE_BUILD_NUMBER: '3',
        HIVECODE_DESKTOP_PLATFORM: platform,
        HIVECODE_DESKTOP_ARCHITECTURE: 'x64',
        HIVECODE_RELEASE_CHANNEL: 'beta',
        HIVECODE_SIGNING_CERTIFICATE_FINGERPRINT: fingerprint,
        HIVECODE_ARTIFACT_PATHS: path,
        HIVECLOUD_RELEASE_ATTESTATION_KEY: Buffer.alloc(32, 7).toString('base64'),
        HIVECODE_PUBLISH: 'true',
        HIVECODE_EXPECTED_ARTIFACTS: '1',
        HIVECODE_EXPECTED_ARTIFACT_ARCHITECTURES: 'x64',
        HIVECODE_EXPECTED_ARTIFACT_FORMATS: ''
      })) {
        vi.stubEnv(key, value)
      }
      const requests = []
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url, options) => {
          expect(options.headers?.clientid).toBe(
            url.includes('/hive/v1/admin/') ? 'release-ci' : undefined
          )
          if (!url.includes('/hive/v1/admin/')) {
            expect(options.headers?.authorization).toBeUndefined()
          }
          requests.push(url)
          if (url.endsWith('/artifacts')) {
            expect(options.body.has('signingCertificateFingerprint')).toBe(platform === 'macos')
            expect(Buffer.from(await options.body.get('file').arrayBuffer())).toEqual(bytes)
            release.artifacts = [artifact]
          }
          if (url.endsWith('/verify')) {
            expect(JSON.parse(options.body).verificationEvidence).toContain(
              platform === 'macos'
                ? `.${fingerprint}.macos.macos-codesign.`
                : '.none.windows.windows-hash.'
            )
          }
          return Response.json(
            url.includes('/updates/check?')
              ? { hasUpdate: true, latest: release, artifact }
              : release
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
  }
)

async function linuxReleaseFixture() {
  const root = mkdtempSync(new URL('linux-publish-', testRoot))
  const release = {
    releaseId: '20000000-0000-4000-8000-000000000002',
    productCode: 'hivecode',
    platform: 'linux',
    channel: 'beta',
    versionName: '1.5.0-beta.3',
    buildNumber: 3,
    status: 'DRAFT',
    artifacts: []
  }
  const artifacts = ['x64', 'arm64'].flatMap((architecture) =>
    ['APPIMAGE', 'DEB', 'TAR_GZ'].map((packageFormat) => {
      const bytes = Buffer.from(`${architecture}/${packageFormat}`)
      const path = join(
        root,
        `${architecture}.${packageFormat === 'TAR_GZ' ? 'tar.gz' : packageFormat.toLowerCase()}`
      )
      writeFileSync(path, bytes)
      return {
        path,
        architecture,
        packageFormat,
        distributionType: 'DIRECT',
        sha256: createHash('sha256').update(bytes).digest('hex'),
        sha512: createHash('sha512').update(bytes).digest('hex'),
        fileSize: bytes.length,
        size: bytes.length,
        status: 'VERIFIED'
      }
    })
  )
  artifacts.forEach((artifact, index) => {
    artifact.artifactId = `40000000-0000-4000-8000-00000000000${index + 1}`
  })
  for (const [key, value] of Object.entries({
    HIVECLOUD_API_URL: 'https://releases.example.test',
    HIVECLOUD_API_CLIENT_ID: 'release-ci',
    HIVECLOUD_API_TOKEN: 'test-token',
    HIVECLOUD_RELEASE_ID: release.releaseId,
    HIVECODE_VERSION: release.versionName,
    HIVECODE_BUILD_NUMBER: '3',
    HIVECODE_DESKTOP_PLATFORM: 'linux',
    HIVECODE_DESKTOP_ARCHITECTURE: 'x64',
    HIVECODE_RELEASE_CHANNEL: 'beta',
    HIVECODE_SIGNING_CERTIFICATE_FINGERPRINT: '',
    HIVECODE_ARTIFACT_PATHS: artifacts
      .map((artifact) => `${artifact.architecture}=${artifact.path}`)
      .join(','),
    HIVECLOUD_RELEASE_ATTESTATION_KEY: Buffer.alloc(32, 7).toString('base64'),
    HIVECODE_PUBLISH: 'true',
    HIVECODE_EXPECTED_ARTIFACTS: '6',
    HIVECODE_EXPECTED_ARTIFACT_ARCHITECTURES: 'x64,arm64',
    HIVECODE_EXPECTED_ARTIFACT_FORMATS: 'APPIMAGE,DEB,TAR_GZ'
  })) {
    vi.stubEnv(key, value)
  }
  const fetchMock = vi.fn(async (url, options) => {
    expect(options.headers?.clientid).toBe(
      url.includes('/hive/v1/admin/') ? 'release-ci' : undefined
    )
    if (!url.includes('/hive/v1/admin/')) {
      expect(options.headers?.authorization).toBeUndefined()
    }
    if (url.endsWith('/artifacts')) {
      const artifact = artifacts.find(
        (candidate) =>
          candidate.architecture === options.body.get('architecture') &&
          candidate.packageFormat === options.body.get('packageFormat')
      )
      expect(artifact).toBeDefined()
      release.artifacts.push(artifact)
    }
    if (url.endsWith('/verify')) {
      expect(JSON.parse(options.body).verificationEvidence).toContain('.none.linux.linux-hash.')
    }
    if (url.endsWith('/publish')) {
      expect(release.artifacts).toHaveLength(6)
    }
    if (url.includes('/updates/check?')) {
      const query = new URL(url).searchParams
      const artifact = artifacts.find(
        (candidate) =>
          candidate.architecture === query.get('architecture') &&
          candidate.packageFormat.toLowerCase() === query.get('packageFormat')
      )
      return Response.json({ hasUpdate: true, latest: release, artifact })
    }
    return Response.json(release)
  })
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(console, 'log').mockImplementation(() => {})
  return { root, artifacts, release, fetchMock }
}

it('publishes and checks every Linux architecture/format pair with independent integrity evidence', async () => {
  const fixture = await linuxReleaseFixture()
  try {
    const { main } = await import('./publish-hivecloud-desktop-release.mjs')
    await main()
    expect(fixture.fetchMock.mock.calls.filter(([url]) => url.endsWith('/verify'))).toHaveLength(6)
    const checks = fixture.fetchMock.mock.calls.filter(([url]) => url.includes('/updates/check?'))
    expect(
      checks.map(([url]) => {
        const query = new URL(url).searchParams
        return `${query.get('architecture')}/${query.get('packageFormat')}`
      })
    ).toEqual([
      'x64/appimage',
      'x64/deb',
      'x64/tar_gz',
      'arm64/appimage',
      'arm64/deb',
      'arm64/tar_gz'
    ])
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

it.each([
  ['HIVECODE_EXPECTED_ARTIFACTS', '2'],
  ['HIVECODE_EXPECTED_ARTIFACT_FORMATS', 'APPIMAGE,APPIMAGE'],
  ['HIVECODE_EXPECTED_ARTIFACT_FORMATS', 'APPIMAGE,ZIP'],
  ['HIVECODE_EXPECTED_ARTIFACT_ARCHITECTURES', 'x64,x64']
])('rejects an invalid matrix before network access: %s=%s', async (key, value) => {
  const fixture = await linuxReleaseFixture()
  try {
    vi.stubEnv(key, value)
    const { main } = await import('./publish-hivecloud-desktop-release.mjs')
    await expect(main()).rejects.toThrow()
    expect(fixture.fetchMock).not.toHaveBeenCalled()
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

it('rejects duplicate artifact inputs instead of counting them toward matrix completeness', async () => {
  const fixture = await linuxReleaseFixture()
  try {
    const spec = `x64=${fixture.artifacts[0].path}`
    vi.stubEnv('HIVECODE_ARTIFACT_PATHS', `${spec},${spec}`)
    const { main } = await import('./publish-hivecloud-desktop-release.mjs')
    await expect(main()).rejects.toThrow('duplicate artifact')
    expect(fixture.fetchMock).not.toHaveBeenCalled()
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

it('requires exactly one verified artifact for every architecture/format pair', async () => {
  const fixture = await linuxReleaseFixture()
  try {
    const { hasExpectedVerifiedArtifacts } = await import('./publish-hivecloud-desktop-release.mjs')
    const expected = [
      'x64/APPIMAGE',
      'x64/DEB',
      'x64/TAR_GZ',
      'arm64/APPIMAGE',
      'arm64/DEB',
      'arm64/TAR_GZ'
    ]
    expect(hasExpectedVerifiedArtifacts({ artifacts: fixture.artifacts }, expected)).toBe(true)
    expect(
      hasExpectedVerifiedArtifacts({ artifacts: fixture.artifacts.slice(0, 3) }, expected)
    ).toBe(false)
    expect(
      hasExpectedVerifiedArtifacts(
        { artifacts: [...fixture.artifacts, fixture.artifacts[0]] },
        expected
      )
    ).toBe(false)
    expect(
      hasExpectedVerifiedArtifacts(
        { artifacts: fixture.artifacts.map((artifact) => ({ ...artifact, status: 'UPLOADED' })) },
        expected
      )
    ).toBe(false)
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

it('rejects missing client identity before uploading any artifact', async () => {
  vi.stubEnv('HIVECLOUD_API_URL', 'https://api.example.test')
  vi.stubEnv('HIVECLOUD_API_TOKEN', 'secret')
  vi.stubEnv('HIVECLOUD_API_CLIENT_ID', ' ')
  const request = vi.fn()
  vi.stubGlobal('fetch', request)
  const { main } = await import('./publish-hivecloud-desktop-release.mjs')
  await expect(main()).rejects.toThrow('HIVECLOUD_API_CLIENT_ID')
  expect(request).not.toHaveBeenCalled()
})
