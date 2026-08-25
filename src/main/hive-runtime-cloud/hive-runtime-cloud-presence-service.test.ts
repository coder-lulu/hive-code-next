import { createHash, generateKeyPairSync } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HiveRuntimeCloudAuthorization } from '../hive-account/hive-account-service'
import { HiveRuntimeCloudRequestError } from './hive-runtime-cloud-client'
import type { HiveRuntimeCloudIdentity } from './hive-runtime-cloud-identity-store'
import type { HiveRuntimeCloudReport } from './hive-runtime-cloud-proof'
import {
  HiveRuntimeCloudPresenceService,
  type PresenceDependencies
} from './hive-runtime-cloud-presence-service'
import type { HiveRuntimeCloudRegistrationState } from './hive-runtime-cloud-state-store'

const ids = [
  '323e4567-e89b-42d3-a456-426614174000',
  '423e4567-e89b-42d3-a456-426614174000',
  '523e4567-e89b-42d3-a456-426614174000',
  '623e4567-e89b-42d3-a456-426614174000'
]
const { privateKey, publicKey } = generateKeyPairSync('ed25519')
const identity: HiveRuntimeCloudIdentity = {
  schemaVersion: 1,
  runtimeInstanceId: '123e4567-e89b-42d3-a456-426614174000',
  privateKeyPkcs8: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
  publicKey: (publicKey.export({ format: 'jwk' }) as { x: string }).x,
  createdAt: 1
}
const authorization: HiveRuntimeCloudAuthorization = {
  accessToken: 'access-secret',
  accountId: '223e4567-e89b-42d3-a456-426614174000',
  authorityId: 'hive-primary',
  sessionExpiresAt: Date.parse('2026-08-26T00:00:00.000Z'),
  sessionGeneration: 1
}
const report = {
  runtimeVersion: '1.4.178-rc.7',
  runtimeProtocolVersion: 3 as const,
  capabilities: ['pairing-v3', 'runtime-health-v1'],
  readiness: 'READY' as const,
  readinessReasonCode: 'healthy',
  startedAt: '2026-08-25T07:59:00.000Z',
  connectionCapabilities: ['orca-direct']
} satisfies HiveRuntimeCloudReport

afterEach(() => vi.restoreAllMocks())

function fixture(stored: HiveRuntimeCloudRegistrationState | null = null) {
  let nextId = 0
  const saveState = vi.fn(
    (_userDataPath: string, _state: HiveRuntimeCloudRegistrationState) => true
  )
  const client = {
    lookup: vi.fn().mockResolvedValue({ exists: false }),
    register: vi.fn().mockResolvedValue({
      runtimeRecordId: '723e4567-e89b-42d3-a456-426614174000',
      runtimeInstanceId: identity.runtimeInstanceId,
      status: 'PENDING_CLAIM',
      claimCapability: 'c'.repeat(64),
      claimExpiresAt: Date.parse('2026-08-25T09:00:00.000Z'),
      resourceVersion: 1
    }),
    claim: vi.fn().mockResolvedValue({
      runtime: {
        runtimeRecordId: '723e4567-e89b-42d3-a456-426614174000',
        runtimeInstanceId: identity.runtimeInstanceId,
        ownerAccountId: authorization.accountId,
        status: 'CLAIMED',
        authorityGeneration: 1,
        fencingEpoch: 1,
        resourceVersion: 2
      },
      credentialActivationToken: 'activation-secret'.repeat(3),
      credentialActivationExpiresAt: Date.parse('2026-08-25T09:00:00.000Z')
    }),
    acquireLease: vi.fn().mockResolvedValue({
      leaseId: '823e4567-e89b-42d3-a456-426614174000',
      authorityGeneration: 1,
      leaseEpoch: 1,
      fencingEpoch: 1
    }),
    heartbeat: vi.fn().mockResolvedValue({
      leaseId: '823e4567-e89b-42d3-a456-426614174000',
      authorityGeneration: 1,
      leaseEpoch: 1,
      fencingEpoch: 1,
      acceptedHeartbeatSeq: 1,
      observedAt: Date.parse('2026-08-25T08:00:00.000Z'),
      leaseExpiresAt: Date.parse('2026-08-25T08:01:15.000Z'),
      presence: 'ONLINE',
      duplicate: false
    })
  }
  const dependencies: PresenceDependencies = {
    createClient: () => client,
    loadIdentity: () => ({ status: 'ok', identity }),
    readState: () => (stored ? { status: 'ok', value: stored } : { status: 'missing' }),
    saveState,
    randomUuid: () => ids[nextId++ % ids.length],
    now: () => Date.parse('2026-08-25T08:00:00.000Z'),
    random: () => 0.5
  }
  const service = new HiveRuntimeCloudPresenceService(
    { enabled: true, apiBaseUrl: 'https://api.hivekernel.com' },
    'C:\\user-data',
    { getReport: () => report },
    dependencies
  )
  return { service, client, saveState }
}

async function activate(service: HiveRuntimeCloudPresenceService): Promise<void> {
  service.setAuthorization(authorization)
  service.setRuntimeReady(true)
  await vi.waitFor(() => expect(service.getState()).toBe('ONLINE'))
}

describe('Hive Runtime Cloud Presence service', () => {
  it('registers, Claims, discards the activation token, leases, and heartbeats immediately', async () => {
    const { service, client, saveState } = fixture()

    await activate(service)

    expect(client.register).toHaveBeenCalledOnce()
    expect(client.claim).toHaveBeenCalledWith(
      expect.objectContaining({ claimCapability: 'c'.repeat(64) }),
      'access-secret',
      expect.any(String),
      expect.any(AbortSignal)
    )
    expect(client.acquireLease).toHaveBeenCalledOnce()
    expect(client.heartbeat).toHaveBeenCalledOnce()
    const heartbeatRequest = client.heartbeat.mock.calls[0]?.[0]
    expect(heartbeatRequest).not.toHaveProperty('webHttpsOrigin')
    expect(heartbeatRequest.report.capabilities).not.toContain('web-launch-grant-v1')
    const persisted = saveState.mock.calls.at(-1)?.[1]
    expect(persisted).toMatchObject({ status: 'CLAIMED', ownerAccountId: authorization.accountId })
    expect(persisted).not.toHaveProperty('credentialActivationToken')
    expect(persisted).not.toHaveProperty('claimCapability')
    await service.stop()
  })

  it('stays Claim-pending when recent step-up authorization is required', async () => {
    const { service, client } = fixture()
    client.claim.mockRejectedValue(
      new HiveRuntimeCloudRequestError(403, 'runtime_claim_step_up_required')
    )

    service.setAuthorization(authorization)
    service.setRuntimeReady(true)
    await vi.waitFor(() => expect(service.getState()).toBe('CLAIM_PENDING'))

    expect(client.acquireLease).not.toHaveBeenCalled()
    await service.stop()
  })

  it('fences and aborts in-flight activation synchronously on sign-out', async () => {
    const { service, client } = fixture()
    let requestSignal: AbortSignal | undefined
    client.lookup.mockImplementation(
      (_request: unknown, signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          requestSignal = signal
          signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
        })
    )
    service.setAuthorization(authorization)
    service.setRuntimeReady(true)
    await vi.waitFor(() => expect(client.lookup).toHaveBeenCalledOnce())

    service.setAuthorization(null)

    expect(service.getState()).toBe('SIGNED_OUT')
    expect(requestSignal?.aborted).toBe(true)
    expect(client.register).not.toHaveBeenCalled()
    await service.stop()
  })

  it('recovers the current tuple after restart and rotates boot before reacquiring', async () => {
    const claimed: HiveRuntimeCloudRegistrationState = {
      schemaVersion: 1,
      runtimeRecordId: '723e4567-e89b-42d3-a456-426614174000',
      status: 'CLAIMED',
      ownerAccountId: authorization.accountId,
      resourceVersion: 2,
      authorityGeneration: 1,
      fencingEpoch: 1,
      latestLeaseEpoch: 1
    }
    const { service, client } = fixture(claimed)
    client.lookup.mockResolvedValue({
      exists: true,
      runtimeRecordId: claimed.runtimeRecordId,
      status: 'CLAIMED',
      resourceVersion: 4,
      authorityGeneration: 3,
      fencingEpoch: 5,
      latestLeaseEpoch: 7,
      identityPublicKeySha256: createHash('sha256')
        .update(Buffer.from(identity.publicKey, 'base64url'))
        .digest('hex')
    })
    client.acquireLease.mockResolvedValue({
      leaseId: '823e4567-e89b-42d3-a456-426614174000',
      authorityGeneration: 3,
      leaseEpoch: 8,
      fencingEpoch: 5
    })
    client.heartbeat.mockResolvedValue({
      leaseId: '823e4567-e89b-42d3-a456-426614174000',
      authorityGeneration: 3,
      leaseEpoch: 8,
      fencingEpoch: 5,
      acceptedHeartbeatSeq: 1,
      observedAt: 1,
      leaseExpiresAt: 2,
      presence: 'ONLINE',
      duplicate: false
    })

    await activate(service)

    expect(client.register).not.toHaveBeenCalled()
    expect(client.claim).not.toHaveBeenCalled()
    expect(client.acquireLease.mock.calls[0]?.[0]).toMatchObject({
      expectedAuthorityGeneration: 3,
      expectedLeaseEpoch: 7,
      expectedFencingEpoch: 5,
      bootId: '423e4567-e89b-42d3-a456-426614174000'
    })
    await service.stop()
  })
})
