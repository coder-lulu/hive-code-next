import { createHmac } from 'node:crypto'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SHA256_PATTERN = /^[0-9a-f]{64}$/i
const SHA512_PATTERN = /^[0-9a-f]{128}$/i
const PLATFORM_VERIFIERS = new Map([
  ['windows', 'windows-authenticode'],
  ['macos', 'macos-codesign'],
  ['android', 'android-apksigner'],
  ['ios', 'ios-codesign'],
  ['linux', 'linux-hash']
])

export function createReleaseVerificationAttestation({
  artifactId,
  sha256,
  sha512,
  signingFingerprint,
  platform,
  key,
  issuedAt = new Date()
}) {
  const normalizedPlatform = String(platform ?? '')
    .trim()
    .toLowerCase()
  const verifier = PLATFORM_VERIFIERS.get(normalizedPlatform)
  const normalizedFingerprint = String(signingFingerprint ?? '')
    .trim()
    .replaceAll(':', '')
    .toLowerCase()
  if (!UUID_PATTERN.test(String(artifactId ?? ''))) {
    throw new Error('HiveCloud verification attestation requires a UUID artifactId')
  }
  if (!SHA256_PATTERN.test(String(sha256 ?? '')) || !SHA512_PATTERN.test(String(sha512 ?? ''))) {
    throw new Error('HiveCloud verification attestation requires SHA-256 and SHA-512 digests')
  }
  if (!verifier) {
    throw new Error(`Unsupported attestation platform: ${normalizedPlatform}`)
  }
  if (normalizedPlatform !== 'linux' && !SHA256_PATTERN.test(normalizedFingerprint)) {
    throw new Error('Signed release attestations require a SHA-256 certificate fingerprint')
  }
  const keyBytes = decodeAttestationKey(key)
  const epochSeconds = Math.floor(issuedAt.getTime() / 1000)
  if (!Number.isSafeInteger(epochSeconds) || epochSeconds < 1) {
    throw new Error('HiveCloud verification attestation timestamp is invalid')
  }
  const canonical = [
    'v1',
    String(epochSeconds),
    String(artifactId).toLowerCase(),
    String(sha256).toLowerCase(),
    String(sha512).toLowerCase(),
    normalizedFingerprint || 'none',
    normalizedPlatform,
    verifier
  ].join('.')
  const signature = createHmac('sha256', keyBytes).update(canonical, 'utf8').digest('base64url')
  return `${canonical}.${signature}`
}

function decodeAttestationKey(value) {
  const encoded = String(value ?? '').trim()
  if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4 !== 0) {
    throw new Error('HIVECLOUD_RELEASE_ATTESTATION_KEY must be valid base64')
  }
  const bytes = Buffer.from(encoded, 'base64')
  if (bytes.length < 32 || bytes.length > 64 || bytes.toString('base64') !== encoded) {
    throw new Error('HIVECLOUD_RELEASE_ATTESTATION_KEY must encode 32 to 64 bytes')
  }
  return bytes
}
