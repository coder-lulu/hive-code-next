import { describe, expect, it } from 'vitest'
import { validateHiveCloudUpdateManifest } from './hivecloud-update-manifest'
import type { HiveCloudUpdateArtifact } from './hivecloud-update-check'

const artifact: HiveCloudUpdateArtifact = {
  packageFormat: 'nsis',
  architecture: 'x64',
  distributionType: 'direct',
  downloadUrl:
    'https://updates.hivekernel.example/hive/v1/update-artifacts/4f1f7c54-06f2-4a22-b4a9-26c9c9b0c3f5/download',
  storeUrl: null,
  sha256: 'a'.repeat(64),
  sha512: 'b'.repeat(128),
  size: 1234
}

function manifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: '1.5.0-beta.1',
    files: [
      {
        url: artifact.downloadUrl,
        sha512: artifact.sha512,
        size: artifact.size
      }
    ],
    path: artifact.downloadUrl,
    sha512: artifact.sha512,
    releaseDate: '2026-08-30T00:00:00Z',
    ...overrides
  }
}

const baseFile = {
  url: artifact.downloadUrl,
  sha512: artifact.sha512,
  size: artifact.size
}

describe('validateHiveCloudUpdateManifest', () => {
  it('accepts the feed emitted by HiveCloud', () => {
    expect(() =>
      validateHiveCloudUpdateManifest(manifest(), {
        versionName: '1.5.0-beta.1',
        artifact
      })
    ).not.toThrow()
  })

  it.each([
    ['a different gateway URL', { files: [{ ...baseFile, url: `${artifact.downloadUrl}/other` }] }],
    ['a different digest', { files: [{ ...baseFile, sha512: 'c'.repeat(128) }] }],
    ['a different size', { files: [{ ...baseFile, size: artifact.size + 1 }] }],
    ['a different legacy path', { path: `${artifact.downloadUrl}?token=secret` }],
    ['two package candidates', { files: [baseFile, baseFile] }]
  ])('rejects %s', (_label, overrides) => {
    expect(() =>
      validateHiveCloudUpdateManifest(manifest(overrides), {
        versionName: '1.5.0-beta.1',
        artifact
      })
    ).toThrow()
  })
})
