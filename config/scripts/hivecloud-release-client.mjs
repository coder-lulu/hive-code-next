import { httpsOrigin, readReleaseResponse } from './hivecloud-release-response.mjs'
import { releaseAuthentication } from './hivecloud-release-auth.mjs'
export {
  ReleaseHttpError,
  httpsOrigin,
  readReleaseResponse
} from './hivecloud-release-response.mjs'

export function releaseClient(environment = process.env, request = fetch) {
  const origin = httpsOrigin(environment.HIVECLOUD_API_URL, 'HIVECLOUD_API_URL')
  const authentication = releaseAuthentication(environment, request)
  return async (path, method = 'GET', body) => {
    if (!/^\/hive\/v1\/admin\/(?:releases|release-batches)(?:[/?]|$)/.test(path)) {
      throw new Error('Unsupported HiveCloud release control path')
    }
    return readReleaseResponse(
      await request(`${origin}${path}`, {
        method,
        redirect: 'error',
        signal: AbortSignal.timeout(30_000),
        headers: {
          accept: 'application/json',
          ...(await authentication()),
          ...(body === undefined ? {} : { 'content-type': 'application/json' })
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      })
    )
  }
}

export const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function assertBatchRelease(environment, release, control) {
  const batchId = String(environment.HIVECLOUD_RELEASE_BATCH_ID ?? '').trim()
  if (!batchId) {
    return
  }
  if (!uuidPattern.test(batchId) || !uuidPattern.test(environment.HIVECLOUD_RELEASE_ID ?? '')) {
    throw new Error('Batch uploads require valid batch and release IDs')
  }
  if (String(environment.HIVECODE_PUBLISH).toLowerCase() !== 'false') {
    throw new Error('Batch members must upload drafts without publishing individually')
  }
  const batch = await control(`/hive/v1/admin/release-batches/${batchId}`)
  const member = batch?.releases?.find((entry) => entry.releaseId === release.releaseId)
  if (
    batch?.batchId !== batchId ||
    String(batch.status).toUpperCase() !== 'DRAFT' ||
    batch.sourceCommit !== environment.HIVECODE_COMMIT_SHA ||
    !/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(batch.sourceCommit ?? '') ||
    batch.productCode !== 'hivecode' ||
    batch.versionName !== release.versionName ||
    String(batch.channel).toLowerCase() !== String(release.channel).toLowerCase() ||
    release.releaseId !== environment.HIVECLOUD_RELEASE_ID ||
    !member ||
    String(member.platform).toLowerCase() !== String(release.platform).toLowerCase() ||
    Number(member.buildNumber) !== Number(release.buildNumber)
  ) {
    throw new Error('Release does not belong to the frozen HiveCloud batch identity')
  }
}
