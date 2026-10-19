import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  releaseBatchPlan,
  artifactIdentity,
  assertBatchPlan
} from './hivecloud-release-batch-contract.mjs'
import { createReleaseBatch, batchOutputs } from './hivecloud-release-batch-plan.mjs'
import { releaseClient, assertBatchRelease, ReleaseHttpError } from './hivecloud-release-client.mjs'
import { publishReleaseBatch } from './hivecloud-release-batch.mjs'

const sourceCommit = 'a'.repeat(40)
const batchId = '10000000-0000-4000-8000-000000000001'
const releaseId = '20000000-0000-4000-8000-000000000001'

afterEach(() => vi.restoreAllMocks())

function plan(channel = 'beta', targets = 'all') {
  const version = channel === 'beta' ? '1.5.0-beta.28' : '1.5.0'
  return releaseBatchPlan({
    pkg: { version },
    mobile: { version },
    app: { expo: { version, android: { versionCode: 41 }, ios: { buildNumber: '3' } } },
    client: { desktopBuildNumber: 28 },
    sourceCommit,
    channel,
    targets
  })
}

function fixture(targets = 'all') {
  const expected = plan('beta', targets)
  const releases = expected.platforms.map((target, index) => ({
    releaseId: `20000000-0000-4000-8000-00000000000${index + 1}`,
    productCode: 'hivecode',
    platform: target.platform,
    channel: 'BETA',
    versionName: expected.versionName,
    buildNumber: target.requestedBuildNumber ?? 28,
    status: 'VERIFIED',
    artifacts: target.artifacts.map((artifact) => ({ ...artifact, status: 'VERIFIED' }))
  }))
  const batch = {
    batchId,
    productCode: 'hivecode',
    versionName: expected.versionName,
    sourceCommit,
    channel: 'BETA',
    status: 'DRAFT',
    idempotencyKey: expected.idempotencyKey,
    releases: releases.map((release, index) => ({
      releaseId: release.releaseId,
      platform: release.platform,
      buildNumber: release.buildNumber,
      artifacts: expected.platforms[index].artifacts
    }))
  }
  const control = vi.fn(async (path, method, payload) => {
    if (path.includes('/release-batches/by-key?')) {
      throw new ReleaseHttpError(404)
    }
    if (path.endsWith('/build-numbers/reserve')) {
      return { buildNumber: payload.requestedBuildNumber ?? 28 }
    }
    if (path === '/hive/v1/admin/releases' && method === 'POST') {
      return releases.find((release) => release.platform === payload.platform)
    }
    if (path === '/hive/v1/admin/release-batches' && method === 'POST') {
      return batch
    }
    return releases.find((release) => path.endsWith(release.releaseId))
  })
  return { expected, releases, batch, control }
}

describe('frozen public release batches', () => {
  it.each(['beta', 'stable'])('requires the full client matrix for %s', (channel) => {
    const expected = plan(channel)
    expect(expected.platforms.map(({ platform }) => platform)).toEqual([
      'WINDOWS',
      'MACOS',
      'LINUX',
      'ANDROID',
      'IOS'
    ])
    expect(expected.platforms.flatMap(({ artifacts }) => artifacts)).toHaveLength(11)
    expect(expected.platforms[2].artifacts.map(artifactIdentity)).toContain('ARM64/DEB/DIRECT')
    expect(expected.platforms[3].requestedBuildNumber).toBe(41)
    expect(expected.platforms[3].artifacts[0].architecture).toBe('UNIVERSAL')
    expect(expected.platforms[4].artifacts[0].distributionType).toBe(
      channel === 'beta' ? 'TESTFLIGHT' : 'APP_STORE'
    )
  })

  it('keeps the Linux and Android batch explicit and distinct from the full default', async () => {
    const { expected, batch, control } = fixture('linux-android')
    expect(expected.platforms.map(({ platform }) => platform)).toEqual(['LINUX', 'ANDROID'])
    expect(expected.platforms.flatMap(({ artifacts }) => artifacts)).toHaveLength(7)
    expect(expected.idempotencyKey).toBe(
      `hivecode:beta:1.5.0-beta.28:linux-android:${sourceCommit}`
    )
    expect(expected.idempotencyKey).not.toBe(plan().idempotencyKey)
    expect(await createReleaseBatch(expected, control)).toEqual(batch)
    expect(control.mock.calls.filter(([path]) => path.endsWith('/reserve'))).toHaveLength(2)
    const outputs = await batchOutputs(batch, control)
    expect(outputs).toMatchObject({
      windows_selected: 'false',
      macos_selected: 'false',
      ios_selected: 'false',
      linux_selected: 'true',
      android_selected: 'true',
      linux_ready: 'true',
      android_ready: 'true'
    })
    expect(outputs.windows_ready).toBeUndefined()
    expect(() => assertBatchPlan(batch, plan(), batch.releases)).toThrow('frozen release plan')
  })

  it('rejects unknown target selections instead of silently omitting clients', () => {
    expect(() => plan('beta', 'available')).toThrow('Release targets')
  })

  it('rejects source or channel drift before creating drafts', () => {
    expect(() => plan('internal')).toThrow('channel')
    expect(() =>
      releaseBatchPlan({
        pkg: { version: '1.5.0-beta.28' },
        mobile: { version: '1.5.0-beta.27' },
        app: {},
        client: {},
        sourceCommit,
        channel: 'beta'
      })
    ).toThrow('versions must agree')
    const expected = plan()
    expect(expected.idempotencyKey).toContain(sourceCommit)
    expect(plan().manifestSha256).toBe(expected.manifestSha256)
  })

  it('reserves native identities, binds every required artifact, and never publishes during planning', async () => {
    const { expected, batch, control } = fixture()
    expect(await createReleaseBatch(expected, control)).toEqual(batch)
    const reservations = control.mock.calls.filter(([path]) => path.endsWith('/reserve'))
    expect(reservations).toHaveLength(5)
    expect(reservations[3][2]).toMatchObject({ platform: 'android', requestedBuildNumber: 41 })
    expect(reservations[4][2]).toMatchObject({ platform: 'ios', requestedBuildNumber: 3 })
    const payload = control.mock.calls.find(([path]) => path.endsWith('/release-batches'))[2]
    expect(payload.releases.flatMap(({ artifacts }) => artifacts)).toHaveLength(11)
    expect(control.mock.calls.some(([path]) => path.endsWith('/publish'))).toBe(false)
  })

  it('rejects a reserved Android build that disagrees with the committed APK identity', async () => {
    const { expected, control } = fixture()
    const request = vi.fn((path, method, body) =>
      body?.platform === 'android' && path.endsWith('/reserve')
        ? { buildNumber: 42 }
        : control(path, method, body)
    )
    await expect(createReleaseBatch(expected, request)).rejects.toThrow('reserved build number')
    expect(request.mock.calls.some(([path]) => path.endsWith('/release-batches'))).toBe(false)
  })

  it('rejects a backend response with an omitted required artifact', async () => {
    const { expected, batch, control } = fixture()
    batch.releases[2].artifacts = batch.releases[2].artifacts.slice(0, -1)
    await expect(createReleaseBatch(expected, control)).rejects.toThrow('matrix differs')
  })

  it.each(['DRAFT', 'PUBLISHED'])(
    'resumes an existing %s batch without reserving or recreating uploaded members',
    async (status) => {
      const { expected, batch } = fixture()
      batch.status = status
      const control = vi.fn(async (path, method) => {
        expect(path).toContain('/release-batches/by-key?')
        expect(method).toBeUndefined()
        return batch
      })
      expect(await createReleaseBatch(expected, control)).toEqual(batch)
      expect(control).toHaveBeenCalledTimes(1)
    }
  )

  it('does not treat permission or service errors as a missing batch', async () => {
    const control = vi.fn(async () => {
      throw new ReleaseHttpError(403)
    })
    await expect(createReleaseBatch(plan(), control)).rejects.toMatchObject({ status: 403 })
    expect(control).toHaveBeenCalledTimes(1)
  })

  it('only skips a completed platform when all of its required artifacts are verified', async () => {
    const { batch, releases, control } = fixture()
    releases[2].artifacts.pop()
    releases[4].artifacts[0].status = 'UPLOADED'
    const outputs = await batchOutputs(batch, control)
    expect(outputs.windows_ready).toBe('true')
    expect(outputs.linux_ready).toBe('false')
    expect(outputs.ios_ready).toBe('false')
    expect(outputs.android_build_number).toBe('41')
  })

  it('blocks individual publishing and cross-source uploads for a batch member', async () => {
    const { batch, releases } = fixture()
    const environment = {
      HIVECLOUD_RELEASE_BATCH_ID: batchId,
      HIVECLOUD_RELEASE_ID: releaseId,
      HIVECODE_COMMIT_SHA: sourceCommit,
      HIVECODE_PUBLISH: 'false'
    }
    await expect(
      assertBatchRelease(environment, releases[0], async () => batch)
    ).resolves.toBeUndefined()
    await expect(
      assertBatchRelease(
        { ...environment, HIVECODE_PUBLISH: 'true' },
        releases[0],
        async () => batch
      )
    ).rejects.toThrow('without publishing individually')
    await expect(
      assertBatchRelease(
        { ...environment, HIVECODE_COMMIT_SHA: 'b'.repeat(40) },
        releases[0],
        async () => batch
      )
    ).rejects.toThrow('frozen HiveCloud batch identity')
  })

  it('does not send the control bearer token to other origins or follow redirects', async () => {
    const request = vi.fn(async () => Response.json({ code: 200, data: { batchId } }))
    const control = releaseClient(
      {
        HIVECLOUD_API_URL: 'https://api.example.test',
        HIVECLOUD_API_CLIENT_ID: 'release-ci',
        HIVECLOUD_API_TOKEN: 'secret'
      },
      request
    )
    await expect(control('https://other.example.test/')).rejects.toThrow('control path')
    expect(request).not.toHaveBeenCalled()
    expect(await control('/hive/v1/admin/release-batches')).toEqual({ batchId })
    expect(request.mock.calls[0][1]).toMatchObject({
      redirect: 'error',
      headers: { authorization: 'Bearer secret', clientid: 'release-ci' }
    })
    expect(() =>
      releaseClient({
        HIVECLOUD_API_URL: 'http://api.example.test',
        HIVECLOUD_API_CLIENT_ID: 'release-ci',
        HIVECLOUD_API_TOKEN: 'secret'
      })
    ).toThrow('HTTPS origin')
  })

  it('never commits a batch if the requested source identity has changed', async () => {
    const { batch } = fixture()
    const request = vi.fn(async () => Response.json(batch))
    await expect(
      publishReleaseBatch(
        {
          HIVECLOUD_API_URL: 'https://api.example.test',
          HIVECLOUD_API_CLIENT_ID: 'release-ci',
          HIVECLOUD_API_TOKEN: 'secret',
          HIVECLOUD_RELEASE_BATCH_ID: batchId,
          HIVECODE_COMMIT_SHA: 'b'.repeat(40),
          HIVECODE_VERSION: batch.versionName,
          HIVECODE_RELEASE_CHANNEL: 'beta'
        },
        request
      )
    ).rejects.toThrow('frozen batch identity')
    expect(request).toHaveBeenCalledTimes(1)
  })
})

it('rejects missing client identity without making a release control request', () => {
  const request = vi.fn()
  expect(() =>
    releaseClient(
      {
        HIVECLOUD_API_URL: 'https://api.example.test',
        HIVECLOUD_API_TOKEN: 'secret',
        HIVECLOUD_API_CLIENT_ID: ' '
      },
      request
    )
  ).toThrow('HIVECLOUD_API_CLIENT_ID')
  expect(request).not.toHaveBeenCalled()
})
