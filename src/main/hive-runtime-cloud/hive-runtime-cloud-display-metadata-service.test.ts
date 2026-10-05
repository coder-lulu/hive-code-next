import { generateKeyPairSync, verify } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { HiveRuntimeCloudRequestError } from './hive-runtime-cloud-http-client'
import { HiveRuntimeCloudManagedSessionRegistry } from './hive-runtime-cloud-managed-session-registry'
import { readManagedRuntimeDisplayMetadata } from './hive-runtime-cloud-display-metadata-service'
import { canonicalRuntimeHeartbeatBody, heartbeatSignatureInput } from './hive-runtime-cloud-proof'
import type { CurrentHiveRuntimeCloudLeaseContext } from './hive-runtime-cloud-lease-context'
import type { RuntimeWebSessionDisplayMetadata } from '../../shared/runtime-display-metadata'

vi.mock('electron', () => ({ net: { fetch: vi.fn() } }))

const { publicKey, privateKey } = generateKeyPairSync('ed25519')
const exportedPublicKey = publicKey.export({ format: 'jwk' })
if (!exportedPublicKey.x) {
  throw new Error('Ed25519 public key must have an x coordinate')
}
const now = Date.now()
const ids = ['1', '2', '3', '4', '5', '6'].map((n) => `${n}23e4567-e89b-42d3-a456-426614174000`)
const context: CurrentHiveRuntimeCloudLeaseContext = {
  authorityId: 'hive-primary',
  identity: {
    schemaVersion: 1,
    runtimeInstanceId: ids[3]!,
    createdAt: now,
    privateKeyPkcs8: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
    publicKey: exportedPublicKey.x
  },
  tuple: {
    authorityGeneration: 2,
    runtimeRecordId: ids[2]!,
    runtimeInstanceId: ids[3]!,
    bootId: ids[4]!,
    heartbeatLeaseId: ids[5]!,
    leaseEpoch: 3,
    fencingEpoch: 4
  }
}
const response = {
  protocolVersion: 'web-session-display-metadata/v1' as const,
  managedWebSessionId: ids[0]!,
  runtimeSessionId: ids[1]!,
  status: 'ACTIVE' as const,
  controlVersion: 1,
  runtimeDisplayMetadata: {
    runtimeRecordId: ids[2]!,
    ownershipEpoch: 8,
    resourceVersion: 9,
    cloudDisplayName: '<备用> 🐝',
    cloudDisplayNameVersion: 7,
    deviceName: '设备'
  }
}

function fixture() {
  const onInvalidate = vi.fn()
  const registry = new HiveRuntimeCloudManagedSessionRegistry({ onInvalidate })
  const { principal } = registry.register({
    ...response,
    currentTuple: context.tuple,
    ownershipEpoch: 8,
    expiresAt: now + 60_000
  })
  const client = {
    readWebSessionDisplayMetadata: vi
      .fn<
        (
          request: Record<string, unknown>,
          signal?: AbortSignal
        ) => Promise<RuntimeWebSessionDisplayMetadata>
      >()
      .mockResolvedValue(response)
  }
  const options = { principal, registry, client, getContext: () => context, now: () => now }
  return { options, onInvalidate }
}

describe('host session-bound metadata read', () => {
  it('signs only registry/principal identifiers, frozen epoch and the current full tuple', async () => {
    const { options } = fixture()
    await expect(readManagedRuntimeDisplayMetadata(options)).resolves.toEqual(response)
    const request = options.client.readWebSessionDisplayMetadata.mock.calls[0]![0]
    const { proof, ...body } = request
    expect(body).toEqual({
      protocolVersion: response.protocolVersion,
      ...context.tuple,
      managedWebSessionId: response.managedWebSessionId,
      runtimeSessionId: response.runtimeSessionId,
      expectedOwnershipEpoch: 8
    })
    expect(proof).toMatchObject({
      path: '/hive/v1/runtime-web-sessions/display-metadata',
      protocolVersion: 'hive-runtime-web-session-display-metadata/v1',
      authorityId: 'hive-primary'
    })
    const signature = z
      .object({
        protocolVersion: z.string(),
        algorithm: z.literal('Ed25519'),
        method: z.literal('POST'),
        path: z.string(),
        authorityId: z.string(),
        issuedAt: z.string(),
        nonce: z.string(),
        bodySha256: z.string(),
        signature: z.string()
      })
      .parse(proof)
    expect(
      verify(
        null,
        Buffer.from(heartbeatSignatureInput(signature)),
        publicKey,
        Buffer.from(signature.signature, 'base64url')
      )
    ).toBe(true)
    expect(canonicalRuntimeHeartbeatBody(body)).not.toContain('accountId')
  })

  it.each([
    new HiveRuntimeCloudRequestError(401, 'runtime_display_metadata_proof_rejected'),
    new HiveRuntimeCloudRequestError(400, 'runtime_display_metadata_request_invalid'),
    new HiveRuntimeCloudRequestError(401, 'unknown_failure'),
    new HiveRuntimeCloudRequestError(429, null, 12_000),
    new HiveRuntimeCloudRequestError(503, null),
    new TypeError('network unavailable')
  ])('preserves Work for unverifiable reads %#', async (error) => {
    const { options, onInvalidate } = fixture()
    options.client.readWebSessionDisplayMetadata.mockRejectedValue(error)
    await expect(readManagedRuntimeDisplayMetadata(options)).rejects.not.toMatchObject({
      code: 'runtime_display_metadata_binding_invalid'
    })
    expect(options.registry.size).toBe(1)
    expect(onInvalidate).not.toHaveBeenCalled()
    if (error instanceof HiveRuntimeCloudRequestError && error.status === 429) {
      await expect(readManagedRuntimeDisplayMetadata(options)).rejects.toMatchObject({
        retryAfterMs: 12_000
      })
    }
  })

  it('invalidates only an explicitly authenticated terminal result', async () => {
    const { options, onInvalidate } = fixture()
    options.client.readWebSessionDisplayMetadata.mockRejectedValue(
      new HiveRuntimeCloudRequestError(410, 'runtime_display_metadata_binding_invalid')
    )
    await expect(readManagedRuntimeDisplayMetadata(options)).rejects.toMatchObject({
      code: 'runtime_display_metadata_binding_invalid'
    })
    expect(options.registry.size).toBe(0)
    expect(onInvalidate).toHaveBeenCalledTimes(1)
  })

  it('rejects late successful data after local revocation and never sends a read for a stale principal', async () => {
    const { options } = fixture()
    let complete!: (value: typeof response) => void
    options.client.readWebSessionDisplayMetadata.mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve
        })
    )
    const reading = readManagedRuntimeDisplayMetadata(options)
    options.registry.revoke(options.principal)
    complete(response)
    await expect(reading).rejects.toMatchObject({
      code: 'runtime_display_metadata_binding_invalid'
    })
    await expect(readManagedRuntimeDisplayMetadata(options)).rejects.toMatchObject({
      code: 'runtime_display_metadata_binding_invalid'
    })
    expect(options.client.readWebSessionDisplayMetadata).toHaveBeenCalledTimes(1)
  })

  it.each([
    { ...response, runtimeSessionId: ids[4]! },
    {
      ...response,
      runtimeDisplayMetadata: { ...response.runtimeDisplayMetadata, ownershipEpoch: 9 }
    },
    {
      ...response,
      runtimeDisplayMetadata: { ...response.runtimeDisplayMetadata, runtimeRecordId: ids[4]! }
    }
  ])(
    'refuses a mismatched response without treating it as proof of revocation %#',
    async (value) => {
      const { options, onInvalidate } = fixture()
      options.client.readWebSessionDisplayMetadata.mockResolvedValue(value)
      await expect(readManagedRuntimeDisplayMetadata(options)).rejects.toMatchObject({
        code: 'runtime_display_metadata_unverifiable'
      })
      expect(onInvalidate).not.toHaveBeenCalled()
    }
  )
})
