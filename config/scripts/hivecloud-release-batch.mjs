import { mkdir, writeFile, appendFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { releaseClient, uuidPattern } from './hivecloud-release-client.mjs'
import { planFromWorkspace, workspaceReleasePlan } from './hivecloud-release-batch-plan.mjs'
import { assertBatchPlan } from './hivecloud-release-batch-contract.mjs'
import { verifyPublicBatch } from './hivecloud-release-batch-public-check.mjs'

export async function publishReleaseBatch(environment = process.env, request = fetch) {
  const batchId = String(environment.HIVECLOUD_RELEASE_BATCH_ID ?? '')
  if (!uuidPattern.test(batchId)) {
    throw new Error('A valid HIVECLOUD_RELEASE_BATCH_ID is required')
  }
  const control = releaseClient(environment, request)
  const current = await control(`/hive/v1/admin/release-batches/${batchId}`)
  if (
    current.batchId !== batchId ||
    current.sourceCommit !== environment.HIVECODE_COMMIT_SHA ||
    current.versionName !== environment.HIVECODE_VERSION ||
    String(current.channel).toLowerCase() !== environment.HIVECODE_RELEASE_CHANNEL ||
    current.productCode !== 'hivecode' ||
    !['DRAFT', 'PUBLISHED'].includes(String(current.status).toUpperCase())
  ) {
    throw new Error('Publish request does not match the frozen batch identity')
  }
  const plan = await workspaceReleasePlan(environment)
  const members = plan.platforms.map((target) => {
    const member = current.releases?.find((entry) => entry.platform === target.platform)
    if (
      !member ||
      (target.requestedBuildNumber !== undefined &&
        Number(member.buildNumber) !== target.requestedBuildNumber)
    ) {
      throw new Error('Publish request differs from the selected native release identities')
    }
    return { ...member, buildNumber: Number(member.buildNumber), artifacts: target.artifacts }
  })
  assertBatchPlan(current, plan, members)
  const published = await control(`/hive/v1/admin/release-batches/${batchId}/publish`, 'POST')
  if (
    published.batchId !== batchId ||
    String(published.status).toUpperCase() !== 'PUBLISHED' ||
    published.sourceCommit !== current.sourceCommit ||
    published.versionName !== current.versionName ||
    JSON.stringify(published.releases) !== JSON.stringify(current.releases)
  ) {
    throw new Error('HiveCloud did not atomically publish the requested batch')
  }
  const receipts = await verifyPublicBatch(published, control, environment, request)
  const evidence = resolve(
    environment.HIVECODE_RELEASE_WORKSPACE || process.cwd(),
    'logs/release-batch'
  )
  await mkdir(evidence, { recursive: true })
  await writeFile(
    join(evidence, 'published.json'),
    `${JSON.stringify({ batch: published, receipts }, null, 2)}\n`
  )
  if (environment.GITHUB_STEP_SUMMARY) {
    await appendFile(
      environment.GITHUB_STEP_SUMMARY,
      `Published HiveCode ${published.versionName}: ${receipts.length} verified public artifacts.\n\nBatch: ${batchId}\n\nSource: ${published.sourceCommit}\n`
    )
  }
  return published
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const action = process.argv[2]
  if (action === 'plan') {
    const { batch } = await planFromWorkspace()
    console.log(`Prepared HiveCode release batch ${batch.batchId} (${batch.versionName})`)
  } else if (action === 'publish') {
    const batch = await publishReleaseBatch()
    console.log(`Published and verified HiveCode release batch ${batch.batchId}`)
  } else {
    throw new Error('Usage: node config/scripts/hivecloud-release-batch.mjs plan|publish')
  }
}
