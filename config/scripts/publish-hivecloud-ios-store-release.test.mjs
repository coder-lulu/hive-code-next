import { describe, it, expect } from 'vitest'
import { createHash, createHmac } from 'node:crypto'
import { main } from './publish-hivecloud-ios-store-release.mjs'
import { createStoreLinkAttestation } from './hivecloud-store-link-attestation.mjs'

const releaseId = '11111111-1111-4111-8111-111111111111'
const artifactId = '22222222-2222-4222-8222-222222222222'
const key = Buffer.alloc(32, 7).toString('base64')
const storeUrl = 'https://testflight.apple.com/join/abc123'
const env = {
  HIVECLOUD_API_URL: 'https://releases.example.test',
  HIVECLOUD_API_CLIENT_ID: 'release-ci',
  HIVECLOUD_API_TOKEN: 'test-token',
  HIVECLOUD_RELEASE_ID: releaseId,
  HIVECODE_VERSION: '1.5.0-beta.27',
  HIVECODE_BUILD_NUMBER: '28',
  HIVECODE_RELEASE_CHANNEL: 'beta',
  HIVECODE_IOS_STORE_URL: storeUrl,
  HIVECLOUD_RELEASE_ATTESTATION_KEY: key
}
const draft = () => ({
  releaseId,
  productCode: 'hivecode',
  platform: 'IOS',
  channel: 'BETA',
  versionName: env.HIVECODE_VERSION,
  buildNumber: 28,
  status: 'DRAFT',
  artifacts: []
})

describe('iOS batch store draft', () => {
  it.each(['batch', 'source'])(
    'rejects mismatched %s before adding or verifying a link',
    async (mismatch) => {
      const batchId = '33333333-3333-4333-8333-333333333333'
      const source = 'a'.repeat(40)
      const environment = {
        ...env,
        HIVECLOUD_RELEASE_BATCH_ID: batchId,
        HIVECODE_COMMIT_SHA: source,
        HIVECODE_PUBLISH: 'false'
      }
      const batch = {
        batchId: mismatch === 'batch' ? artifactId : batchId,
        status: 'DRAFT',
        sourceCommit: mismatch === 'source' ? 'b'.repeat(40) : source,
        productCode: 'hivecode',
        versionName: env.HIVECODE_VERSION,
        channel: 'BETA',
        releases: [draft()]
      }
      await expect(
        main(environment, async (url, options) => {
          expect(options.method).toBe('GET')
          return Response.json(url.includes('/release-batches/') ? batch : draft())
        })
      ).rejects.toThrow('frozen HiveCloud batch identity')
    }
  )
  it('registers and verifies without publishing and supports retry', async () => {
    const release = draft()
    const calls = []
    const fake = async (url, options) => {
      calls.push([url, options.method])
      if (url.endsWith('/store-links')) {
        release.status = 'UPLOADING'
        release.artifacts.push({
          artifactId,
          architecture: 'ANY',
          packageFormat: 'STORE_LINK',
          distributionType: 'TESTFLIGHT',
          storeUrl,
          status: 'UPLOADED'
        })
      }
      if (url.endsWith('/verify')) {
        expect(JSON.parse(options.body).verificationEvidence).toMatch(/^v1-store\./)
        release.artifacts[0].status = 'VERIFIED'
        release.status = 'VERIFIED'
      }
      return Response.json(release)
    }
    await main(env, fake)
    await main(env, fake)
    expect(calls.filter(([, method]) => method === 'POST')).toHaveLength(3)
    expect(calls.filter(([url]) => url.endsWith('/verify'))).toHaveLength(2)
    expect(calls.some(([url]) => url.endsWith('/publish'))).toBe(false)
  })
  it('reverifies an existing VERIFIED link with a freshly signed proof', async () => {
    const release = {
      ...draft(),
      artifacts: [
        {
          artifactId,
          architecture: 'ANY',
          packageFormat: 'STORE_LINK',
          distributionType: 'TESTFLIGHT',
          storeUrl,
          status: 'VERIFIED'
        }
      ]
    }
    const proofs = []
    await main(env, async (url, options) => {
      if (options.method === 'POST') {
        expect(url).toBe(
          `${env.HIVECLOUD_API_URL}/hive/v1/admin/releases/artifacts/${artifactId}/verify`
        )
        proofs.push(JSON.parse(options.body).verificationEvidence)
      }
      return Response.json(release)
    })
    expect(proofs).toHaveLength(1)
    expect(proofs[0]).toMatch(/^v1-store\./)
    expect(Math.abs(Number(proofs[0].split('.')[1]) - Math.floor(Date.now() / 1000))).toBeLessThan(
      5
    )
  })
  it('rejects a different release before writing', async () => {
    const release = { ...draft(), buildNumber: 29 }
    await expect(
      main(env, async (_, options) => {
        expect(options.method).toBe('GET')
        return Response.json(release)
      })
    ).rejects.toThrow('identity mismatch')
  })
  it('rejects conflicting store link', async () => {
    const release = draft()
    release.artifacts = [
      { packageFormat: 'STORE_LINK', storeUrl: 'https://testflight.apple.com/join/other' }
    ]
    await expect(main(env, async () => Response.json(release))).rejects.toThrow('Conflicting')
  })
  it('signs all immutable store identity fields using the server protocol', () => {
    const identity = {
      artifactId,
      releaseId,
      productCode: 'hivecode',
      channel: 'BETA',
      versionName: env.HIVECODE_VERSION,
      buildNumber: 28,
      distributionType: 'TESTFLIGHT',
      storeUrl,
      key,
      issuedAt: new Date('2026-10-19T00:00:00Z')
    }
    const digest = createHash('sha256')
      .update(
        [
          'release-store-link-v1',
          artifactId,
          releaseId,
          'hivecode',
          'ios',
          'beta',
          identity.versionName,
          '28',
          'testflight',
          storeUrl
        ].join('\n')
      )
      .digest('hex')
    const prefix = `v1-store.1792368000.${artifactId}.${digest}`
    expect(createStoreLinkAttestation(identity)).toBe(
      `${prefix}.${createHmac('sha256', Buffer.from(key, 'base64')).update(prefix).digest('base64url')}`
    )
    expect(createStoreLinkAttestation({ ...identity, buildNumber: 29 })).not.toBe(
      createStoreLinkAttestation(identity)
    )
  })
})
