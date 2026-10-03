import { describe, expect, it } from 'vitest'
import { validateHiveCloudArtifactForRequest } from './hivecloud-update-artifact-validation'

const origin = 'https://updates.hive.test'
const gateway = '/hive/v1/update-artifacts/4f1f7c54-06f2-4a22-b4a9-26c9c9b0c3f5/download'
const options = { platform: 'windows', architecture: 'x64', channel: 'beta' }
const artifact = {
  packageFormat: 'nsis',
  architecture: 'x64',
  distributionType: 'direct',
  downloadUrl: `${origin}${gateway}/HiveCode-Setup.exe`,
  storeUrl: null,
  sha256: 'a'.repeat(64),
  sha512: 'b'.repeat(128),
  size: 123
}

describe('named HiveCloud artifact gateway', () => {
  it('accepts a filename while retaining the UUID-scoped gateway', () => {
    expect(() => validateHiveCloudArtifactForRequest(artifact, options, origin)).not.toThrow()
  })

  it.each([
    `${origin}${gateway}/nested/HiveCode.exe`,
    `${origin}${gateway}/nested%2fHiveCode.exe`,
    `${origin}${gateway}/%252e%252e`,
    `${origin}${gateway}/HiveCode.exe?token=secret`,
    `${origin}${gateway}/HiveCode.exe#fragment`,
    `https://foreign.test${gateway}/HiveCode.exe`,
    `${origin}${gateway.replace('/update-artifacts/', '/internal-update-artifacts/')}/HiveCode.exe`
  ])('rejects a filename URL outside the requested authority: %s', (downloadUrl) => {
    expect(() =>
      validateHiveCloudArtifactForRequest({ ...artifact, downloadUrl }, options, origin)
    ).toThrow('outside the object-storage gateway')
  })
})
