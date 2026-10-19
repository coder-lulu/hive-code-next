import { pathToFileURL } from 'node:url'
import { releaseClient, assertBatchRelease, uuidPattern } from './hivecloud-release-client.mjs'
import { createStoreLinkAttestation } from './hivecloud-store-link-attestation.mjs'

export async function main(env = process.env, fetchImpl = fetch) {
  const required = (name) => {
    const value = String(env[name] ?? '').trim()
    if (!value) {
      throw new Error(`${name} is required`)
    }
    return value
  }
  const control = releaseClient(env, fetchImpl)
  const releaseId = required('HIVECLOUD_RELEASE_ID')
  if (!uuidPattern.test(releaseId)) {
    throw new Error('Invalid release UUID')
  }
  const versionName = required('HIVECODE_VERSION')
  const buildNumber = Number(required('HIVECODE_BUILD_NUMBER'))
  if (!Number.isSafeInteger(buildNumber) || buildNumber < 1) {
    throw new Error('Invalid build number')
  }
  const channel = required('HIVECODE_RELEASE_CHANNEL')
  if (!['beta', 'stable'].includes(channel)) {
    throw new Error('Unsupported iOS channel')
  }
  const distributionType = channel === 'beta' ? 'TESTFLIGHT' : 'APP_STORE'
  const storeUrl = required('HIVECODE_IOS_STORE_URL')
  const url = new URL(storeUrl)
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.port ||
    url.hostname !== (channel === 'beta' ? 'testflight.apple.com' : 'apps.apple.com')
  ) {
    throw new Error('Invalid Apple URL')
  }
  const key = required('HIVECLOUD_RELEASE_ATTESTATION_KEY')
  const path = `/hive/v1/admin/releases/${releaseId}`
  let release = await control(path)
  const checkIdentity = () => {
    if (
      release.releaseId !== releaseId ||
      release.productCode !== 'hivecode' ||
      String(release.platform).toLowerCase() !== 'ios' ||
      String(release.channel).toLowerCase() !== channel ||
      release.versionName !== versionName ||
      Number(release.buildNumber) !== buildNumber ||
      !['DRAFT', 'UPLOADING', 'VERIFYING', 'VERIFIED'].includes(release.status)
    ) {
      throw new Error('HiveCloud iOS draft identity mismatch')
    }
  }
  checkIdentity()
  await assertBatchRelease(env, release, control)
  const candidates = () => (release.artifacts ?? []).filter((a) => a.packageFormat === 'STORE_LINK')
  if (candidates().length === 0) {
    release = await control(`${path}/store-links`, 'POST', { distributionType, storeUrl })
  }
  checkIdentity()
  const matches = candidates()
  if (
    matches.length !== 1 ||
    matches[0].storeUrl !== storeUrl ||
    matches[0].distributionType !== distributionType ||
    matches[0].architecture !== 'ANY'
  ) {
    throw new Error('Conflicting iOS store artifact')
  }
  const artifact = matches[0]
  if (!['UPLOADED', 'VERIFIED'].includes(artifact.status)) {
    throw new Error('Store link is not eligible for verification')
  }
  // A persisted VERIFIED flag does not prove the current Apple availability check.
  const verificationEvidence = createStoreLinkAttestation({
    artifactId: artifact.artifactId,
    releaseId,
    productCode: 'hivecode',
    channel,
    versionName,
    buildNumber,
    distributionType,
    storeUrl: artifact.storeUrl,
    key
  })
  await control(`/hive/v1/admin/releases/artifacts/${artifact.artifactId}/verify`, 'POST', {
    verificationEvidence
  })
  release = await control(path)
  checkIdentity()
  if (
    !release.artifacts?.some(
      (a) =>
        a.artifactId === artifact.artifactId && a.status === 'VERIFIED' && a.storeUrl === storeUrl
    )
  ) {
    throw new Error('iOS store verification did not complete')
  }
  return release
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
