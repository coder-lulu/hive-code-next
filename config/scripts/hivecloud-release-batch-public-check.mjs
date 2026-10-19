import { createHash } from 'node:crypto'
import { artifactIdentity } from './hivecloud-release-batch-contract.mjs'
import { httpsOrigin, readReleaseResponse } from './hivecloud-release-client.mjs'

const MAX_ARTIFACT_BYTES = 512 * 1024 * 1024

async function verifyDownload(artifact, origin, request) {
  const path = `/hive/v1/update-artifacts/${artifact.artifactId}/download`
  let url = new URL(artifact.downloadUrl)
  const downloadPath =
    String(artifact.packageFormat).toUpperCase() === 'NSIS' ? `${path}/HiveCode-Setup.exe` : path
  if (url.origin !== origin || url.pathname !== downloadPath || url.search || url.hash) {
    throw new Error('Public artifact download does not use the configured release service')
  }
  const signal = AbortSignal.timeout(15 * 60 * 1000)
  let response
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    if (url.protocol !== 'https:' || url.username || url.password) {
      throw new Error('Public artifact download must remain HTTPS')
    }
    response = await request(url.toString(), { redirect: 'manual', signal })
    if (![301, 302, 303, 307, 308].includes(response.status)) {
      break
    }
    const location = response.headers.get('location')
    await response.body?.cancel()
    if (!location || redirects === 3) {
      throw new Error('Public artifact redirect limit exceeded')
    }
    url = new URL(location, url)
  }
  if (!response?.ok) {
    throw new Error(`Public artifact download failed (${response?.status})`)
  }
  const expectedSize = Number(artifact.size)
  if (
    !Number.isSafeInteger(expectedSize) ||
    expectedSize < 1 ||
    expectedSize > MAX_ARTIFACT_BYTES
  ) {
    await response.body?.cancel()
    throw new Error('Public artifact size is outside the release limit')
  }
  const sha256 = createHash('sha256')
  const sha512 = createHash('sha512')
  let size = 0
  try {
    for await (const chunk of response.body ?? []) {
      size += chunk.byteLength
      if (size > expectedSize) {
        throw new Error('Public artifact exceeds its declared size')
      }
      sha256.update(chunk)
      sha512.update(chunk)
    }
  } catch (error) {
    await response.body?.cancel().catch(() => {})
    throw error
  }
  if (
    size !== expectedSize ||
    sha256.digest('hex') !== String(artifact.sha256).toLowerCase() ||
    sha512.digest('hex') !== String(artifact.sha512).toLowerCase()
  ) {
    throw new Error('Public artifact bytes do not match the verified release')
  }
}

export async function verifyPublicBatch(
  batch,
  control,
  environment = process.env,
  request = fetch
) {
  const origin = httpsOrigin(
    environment.HIVECLOUD_PUBLIC_RELEASE_URL || environment.HIVECLOUD_API_URL,
    'HIVECLOUD_PUBLIC_RELEASE_URL'
  )
  const receipts = []
  for (const member of batch.releases) {
    const release = await control(`/hive/v1/admin/releases/${member.releaseId}`)
    for (const expected of member.artifacts) {
      const matches =
        release.artifacts?.filter(
          (artifact) =>
            artifactIdentity(artifact) === artifactIdentity(expected) &&
            String(artifact.status).toUpperCase() === 'VERIFIED'
        ) ?? []
      if (matches.length !== 1) {
        throw new Error('Published batch is missing a required verified artifact')
      }
      const expectedArtifact = matches[0]
      const query = new URLSearchParams({
        product: batch.productCode,
        platform: String(member.platform).toLowerCase(),
        architecture: String(expected.architecture).toLowerCase(),
        channel: String(batch.channel).toLowerCase(),
        ...(String(expected.packageFormat).toUpperCase() === 'STORE_LINK'
          ? {}
          : { packageFormat: String(expected.packageFormat).toLowerCase() }),
        currentVersion: '0.0.0-beta.0',
        currentBuild: '1'
      })
      const check = await readReleaseResponse(
        await request(`${origin}/hive/v1/updates/check?${query}`, {
          redirect: 'error',
          signal: AbortSignal.timeout(30_000),
          headers: { accept: 'application/json' }
        })
      )
      const actual = check?.artifact ?? check?.latest?.artifact
      if (
        !check?.hasUpdate ||
        check.latest?.versionName !== batch.versionName ||
        Number(check.latest?.buildNumber) !== Number(member.buildNumber) ||
        actual?.artifactId !== expectedArtifact.artifactId ||
        artifactIdentity(actual) !== artifactIdentity(expected)
      ) {
        throw new Error(
          `Public update check did not expose ${member.platform}/${artifactIdentity(expected)}`
        )
      }
      if (String(expected.distributionType).toUpperCase() === 'DIRECT') {
        if (
          actual.sha256 !== expectedArtifact.sha256 ||
          actual.sha512 !== expectedArtifact.sha512 ||
          Number(actual.size) !== Number(expectedArtifact.fileSize)
        ) {
          throw new Error('Public artifact integrity metadata differs from the verified draft')
        }
        await verifyDownload(actual, origin, request)
      } else if (actual.storeUrl !== expectedArtifact.storeUrl) {
        throw new Error('Public iOS store link differs from the verified release')
      }
      receipts.push({ platform: member.platform, artifactId: actual.artifactId, ...expected })
    }
  }
  return receipts
}
