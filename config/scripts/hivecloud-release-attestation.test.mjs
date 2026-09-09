import { describe, expect, it } from 'vitest'
import { createReleaseVerificationAttestation } from './hivecloud-release-attestation.mjs'

const key = Buffer.alloc(32, 7).toString('base64')
const input = {
  artifactId: '4f1f7c54-06f2-4a22-b4a9-26c9c9b0c3f5',
  sha256: 'a'.repeat(64),
  sha512: 'b'.repeat(128),
  signingFingerprint: 'c'.repeat(64),
  platform: 'android',
  key,
  issuedAt: new Date('2026-08-31T00:00:00Z')
}

describe('HiveCloud release verification attestation', () => {
  it('attests unsigned Windows artifacts by hash without a certificate', () => {
    expect(
      createReleaseVerificationAttestation({
        ...input,
        platform: 'windows',
        signingFingerprint: ''
      })
    ).toContain('.none.windows.windows-hash.')
  })

  it('binds a native verifier, artifact identity, hashes, fingerprint, and timestamp', () => {
    const token = createReleaseVerificationAttestation(input)

    expect(token).toContain('.android.android-apksigner.')
    expect(token.split('.')).toHaveLength(9)
    expect(token).toBe(createReleaseVerificationAttestation(input))
  })

  it('rejects weak keys and missing signed-platform fingerprints', () => {
    expect(() => createReleaseVerificationAttestation({ ...input, key: 'YQ==' })).toThrow(
      '32 to 64 bytes'
    )
    expect(() =>
      createReleaseVerificationAttestation({ ...input, signingFingerprint: '' })
    ).toThrow('fingerprint')
  })

  it('allows Linux hash attestations without pretending AppImage is platform-signed', () => {
    expect(
      createReleaseVerificationAttestation({
        ...input,
        platform: 'linux',
        signingFingerprint: ''
      })
    ).toContain('.none.linux.linux-hash.')
  })
})
