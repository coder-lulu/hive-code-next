import { createHash, createHmac } from 'node:crypto'

export function createStoreLinkAttestation({
  artifactId,
  releaseId,
  productCode,
  channel,
  versionName,
  buildNumber,
  distributionType,
  storeUrl,
  key,
  issuedAt = new Date()
}) {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  if (!uuid.test(artifactId) || !uuid.test(releaseId)) {
    throw new Error('Store attestation requires UUID identities')
  }
  const fields = [
    'release-store-link-v1',
    artifactId.toLowerCase(),
    releaseId.toLowerCase(),
    productCode,
    'ios',
    channel.toLowerCase(),
    versionName,
    String(buildNumber),
    distributionType.toLowerCase(),
    storeUrl
  ]
  if (fields.some((field) => !field || /[\r\n]/.test(field))) {
    throw new Error('Invalid store attestation identity')
  }
  const encoded = String(key ?? '').trim()
  const bytes = Buffer.from(encoded, 'base64')
  if (bytes.length < 32 || bytes.length > 64 || bytes.toString('base64') !== encoded) {
    throw new Error('Attestation key must encode 32 to 64 bytes')
  }
  const seconds = Math.floor(issuedAt.getTime() / 1000)
  if (!Number.isSafeInteger(seconds) || seconds < 1) {
    throw new Error('Invalid attestation timestamp')
  }
  const digest = createHash('sha256').update(fields.join('\n')).digest('hex')
  const canonical = ['v1-store', seconds, artifactId.toLowerCase(), digest].join('.')
  return `${canonical}.${createHmac('sha256', bytes).update(canonical).digest('base64url')}`
}
