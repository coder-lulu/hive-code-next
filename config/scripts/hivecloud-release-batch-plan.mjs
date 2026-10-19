import { readFile, mkdir, writeFile, appendFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  releaseBatchPlan,
  assertBatchPlan,
  artifactIdentity
} from './hivecloud-release-batch-contract.mjs'
import { releaseClient, uuidPattern, ReleaseHttpError } from './hivecloud-release-client.mjs'

export async function createReleaseBatch(plan, control, releaseNotes = '') {
  const lookup = new URLSearchParams({ product: plan.product, idempotencyKey: plan.idempotencyKey })
  try {
    const existing = await control(`/hive/v1/admin/release-batches/by-key?${lookup}`)
    const members = plan.platforms.map((target) => {
      const member = existing?.releases?.find(
        (entry) => String(entry.platform).toUpperCase() === target.platform
      )
      const buildNumber = Number(member?.buildNumber)
      if (
        !uuidPattern.test(member?.releaseId ?? '') ||
        !Number.isSafeInteger(buildNumber) ||
        buildNumber < 1 ||
        (target.requestedBuildNumber !== undefined && target.requestedBuildNumber !== buildNumber)
      ) {
        throw new Error(`Existing batch has a different native identity for ${target.platform}`)
      }
      return {
        releaseId: member.releaseId,
        platform: target.platform,
        buildNumber,
        artifacts: target.artifacts
      }
    })
    if (!uuidPattern.test(existing?.batchId ?? '')) {
      throw new Error('HiveCloud returned an invalid existing batch ID')
    }
    assertBatchPlan(existing, plan, members)
    return existing
  } catch (error) {
    if (!(error instanceof ReleaseHttpError) || error.status !== 404) {
      throw error
    }
  }
  const members = []
  for (const target of plan.platforms) {
    const platform = target.platform.toLowerCase()
    const reserved = await control('/hive/v1/admin/releases/build-numbers/reserve', 'POST', {
      product: plan.product,
      platform,
      channel: plan.channel,
      reservationKey: `${plan.product}:${platform}:${plan.channel}:${plan.versionName}`,
      requestedBuildNumber: target.requestedBuildNumber ?? null
    })
    const buildNumber = Number(reserved?.buildNumber)
    if (
      !Number.isSafeInteger(buildNumber) ||
      buildNumber < 1 ||
      (target.requestedBuildNumber !== undefined && buildNumber !== target.requestedBuildNumber)
    ) {
      throw new Error(`Invalid reserved build number for ${platform}`)
    }
    const release = await control('/hive/v1/admin/releases', 'POST', {
      product: plan.product,
      platform: target.platform,
      channel: plan.channel.toUpperCase(),
      versionName: plan.versionName,
      buildNumber,
      releaseNotes,
      mandatory: false
    })
    if (
      !uuidPattern.test(release?.releaseId ?? '') ||
      release.productCode !== plan.product ||
      String(release.platform).toUpperCase() !== target.platform ||
      String(release.channel).toLowerCase() !== plan.channel ||
      release.versionName !== plan.versionName ||
      Number(release.buildNumber) !== buildNumber
    ) {
      throw new Error(`HiveCloud returned a different release identity for ${platform}`)
    }
    members.push({
      releaseId: release.releaseId,
      platform: target.platform,
      buildNumber,
      artifacts: target.artifacts
    })
  }
  const batch = await control('/hive/v1/admin/release-batches', 'POST', {
    product: plan.product,
    channel: plan.channel.toUpperCase(),
    versionName: plan.versionName,
    sourceCommit: plan.sourceCommit,
    idempotencyKey: plan.idempotencyKey,
    releases: members.map(({ releaseId, artifacts }) => ({ releaseId, artifacts }))
  })
  if (!uuidPattern.test(batch?.batchId ?? '')) {
    throw new Error('HiveCloud returned an invalid batch ID')
  }
  assertBatchPlan(batch, plan, members)
  return batch
}

export async function batchOutputs(batch, control) {
  const outputs = {
    batch_id: batch.batchId,
    source_sha: batch.sourceCommit,
    version: batch.versionName,
    channel: String(batch.channel).toLowerCase(),
    already_published: String(String(batch.status).toUpperCase() === 'PUBLISHED')
  }
  for (const platform of ['windows', 'macos', 'linux', 'android', 'ios']) {
    outputs[`${platform}_selected`] = 'false'
  }
  for (const member of batch.releases) {
    const release = await control(`/hive/v1/admin/releases/${member.releaseId}`)
    if (
      release?.releaseId !== member.releaseId ||
      Number(release.buildNumber) !== Number(member.buildNumber) ||
      release.versionName !== batch.versionName ||
      String(release.channel).toLowerCase() !== outputs.channel ||
      String(release.platform).toUpperCase() !== String(member.platform).toUpperCase() ||
      release.productCode !== batch.productCode
    ) {
      throw new Error('Batch member identity changed while planning')
    }
    const prefix = String(member.platform).toLowerCase()
    outputs[`${prefix}_selected`] = 'true'
    outputs[`${prefix}_release_id`] = member.releaseId
    outputs[`${prefix}_build_number`] = String(member.buildNumber)
    outputs[`${prefix}_ready`] = String(
      member.artifacts.every(
        (required) =>
          release.artifacts?.filter(
            (actual) =>
              artifactIdentity(actual) === artifactIdentity(required) &&
              String(actual.status).toUpperCase() === 'VERIFIED'
          ).length === 1
      )
    )
  }
  return outputs
}

export async function workspaceReleasePlan(environment = process.env) {
  const root = resolve(environment.HIVECODE_RELEASE_WORKSPACE || process.cwd())
  const json = async (path) => JSON.parse(await readFile(join(root, path), 'utf8'))
  const [pkg, mobile, app, client] = await Promise.all([
    json('package.json'),
    json('mobile/package.json'),
    json('mobile/app.json'),
    json('config/client-build.json')
  ])
  return releaseBatchPlan({
    pkg,
    mobile,
    app,
    client,
    sourceCommit: environment.HIVECODE_COMMIT_SHA,
    channel: environment.HIVECODE_RELEASE_CHANNEL,
    targets: environment.HIVECODE_RELEASE_TARGETS || 'all'
  })
}

export async function planFromWorkspace(environment = process.env, request = fetch) {
  const root = resolve(environment.HIVECODE_RELEASE_WORKSPACE || process.cwd())
  const plan = await workspaceReleasePlan(environment)
  const control = releaseClient(environment, request)
  const batch = await createReleaseBatch(plan, control, environment.HIVECODE_RELEASE_NOTES || '')
  const outputs = await batchOutputs(batch, control)
  const evidence = join(root, 'logs/release-batch')
  await mkdir(evidence, { recursive: true })
  await writeFile(join(evidence, 'batch.json'), `${JSON.stringify(batch, null, 2)}\n`)
  await writeFile(join(evidence, 'plan.json'), `${JSON.stringify(plan, null, 2)}\n`)
  if (environment.GITHUB_OUTPUT) {
    await appendFile(
      environment.GITHUB_OUTPUT,
      Object.entries(outputs)
        .map(([name, value]) => `${name}=${value}\n`)
        .join('')
    )
  }
  return { batch, outputs }
}
