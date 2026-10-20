import { createHash } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { verifyPublicBatch } from './hivecloud-release-batch-public-check.mjs'

afterEach(() => {
  vi.restoreAllMocks()
})

function fixture() {
  const bytes = Buffer.from('qualified published installer')
  const artifact = {
    artifactId: '30000000-0000-4000-8000-000000000001',
    architecture: 'x64',
    packageFormat: 'nsis',
    distributionType: 'direct',
    status: 'VERIFIED',
    size: bytes.length,
    fileSize: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    sha512: createHash('sha512').update(bytes).digest('hex')
  }
  artifact.downloadUrl = `https://releases.example.test/hive/v1/update-artifacts/${artifact.artifactId}/download/HiveCode-Setup.exe`
  const batch = {
    productCode: 'hivecode',
    channel: 'BETA',
    versionName: '1.5.0-beta.28',
    status: 'PUBLISHED',
    releases: [
      {
        releaseId: '20000000-0000-4000-8000-000000000001',
        platform: 'WINDOWS',
        buildNumber: 28,
        artifacts: [{ architecture: 'X64', packageFormat: 'NSIS', distributionType: 'DIRECT' }]
      }
    ]
  }
  const expectedArtifact = structuredClone(artifact)
  const control = vi.fn(async () => ({ artifacts: [expectedArtifact] }))
  const check = {
    hasUpdate: true,
    latest: { versionName: batch.versionName, buildNumber: 28 },
    artifact
  }
  const request = vi.fn(async (url) =>
    url.includes('/updates/check?')
      ? Response.json(check)
      : url.includes('/update-artifacts/')
        ? new Response(null, {
            status: 302,
            headers: { location: 'https://storage.example.test/private/object?signed=redacted' }
          })
        : new Response(bytes)
  )
  const environment = { HIVECLOUD_PUBLIC_RELEASE_URL: 'https://releases.example.test' }
  return { bytes, artifact, batch, control, check, request, environment }
}

it('checks the real public API and streams the final bytes without forwarding release credentials', async () => {
  const { artifact, batch, control, request, environment } = fixture()
  const durations = new Map()
  const timeout = AbortSignal.timeout.bind(AbortSignal)
  vi.spyOn(AbortSignal, 'timeout').mockImplementation((milliseconds) => {
    const signal = timeout(milliseconds)
    durations.set(signal, milliseconds)
    return signal
  })
  expect(await verifyPublicBatch(batch, control, environment, request)).toHaveLength(1)
  expect(request.mock.calls[0][0]).toContain('packageFormat=nsis')
  expect(request.mock.calls[1][0]).toBe(artifact.downloadUrl)
  expect(request).toHaveBeenCalledTimes(3)
  for (const [url, options] of request.mock.calls) {
    const metadata = url.includes('/updates/check?')
    expect(durations.get(options.signal)).toBe(metadata ? 30_000 : 45 * 60 * 1000)
    expect(options.redirect).toBe(metadata ? 'error' : 'manual')
    expect(options.headers?.authorization).toBeUndefined()
  }
  expect(request.mock.calls[2][1].signal).toBe(request.mock.calls[1][1].signal)
})

it.each(['version', 'format', 'id'])(
  'rejects a public feed that exposes a different %s',
  async (field) => {
    const { batch, control, request, environment, check } = fixture()
    if (field === 'version') {
      check.latest.versionName = '1.5.0-beta.27'
    }
    if (field === 'format') {
      check.artifact.packageFormat = 'zip'
    }
    if (field === 'id') {
      check.artifact.artifactId = '30000000-0000-4000-8000-000000000002'
    }
    await expect(verifyPublicBatch(batch, control, environment, request)).rejects.toThrow(
      'did not expose'
    )
    expect(request).toHaveBeenCalledTimes(1)
  }
)

it('rejects truncated bytes from object storage even when the metadata is correct', async () => {
  const { batch, control, request, environment } = fixture()
  const truncated = vi.fn((url, options) =>
    url.includes('storage.example.test') ? new Response('short') : request(url, options)
  )
  await expect(verifyPublicBatch(batch, control, environment, truncated)).rejects.toThrow(
    'bytes do not match'
  )
})

it('rejects a download URL that leaves the configured public service before obtaining a storage redirect', async () => {
  const { artifact, batch, control, request, environment } = fixture()
  artifact.downloadUrl = 'https://other.example.test/file.exe'
  await expect(verifyPublicBatch(batch, control, environment, request)).rejects.toThrow(
    'configured release service'
  )
  expect(request).toHaveBeenCalledTimes(1)
})

it('queries iOS through the store-aware route without the desktop packageFormat filter', async () => {
  const { batch, control, check, request, environment } = fixture()
  const target = {
    architecture: 'ANY',
    packageFormat: 'STORE_LINK',
    distributionType: 'TESTFLIGHT'
  }
  batch.releases[0].platform = 'IOS'
  batch.releases[0].artifacts = [target]
  const artifact = {
    ...check.artifact,
    ...target,
    storeUrl: 'https://testflight.apple.com/join/Abc123',
    downloadUrl: null,
    sha256: null,
    sha512: null,
    size: null,
    fileSize: null
  }
  check.artifact = artifact
  control.mockResolvedValue({ artifacts: [artifact] })
  expect(await verifyPublicBatch(batch, control, environment, request)).toHaveLength(1)
  const query = new URL(request.mock.calls[0][0]).searchParams
  expect(query.get('platform')).toBe('ios')
  expect(query.has('packageFormat')).toBe(false)
  expect(request).toHaveBeenCalledTimes(1)
})
