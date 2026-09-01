import { createHash, generateKeyPairSync } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HiveRuntimeCloudAuthorization } from '../hive-account/hive-account-service'
import type { HiveRuntimeCloudIdentity } from './hive-runtime-cloud-identity-store'
import type { HiveRuntimeCloudReport } from './hive-runtime-cloud-proof'
import { HiveRuntimeCloudPresenceService } from './hive-runtime-cloud-presence-service'
import type { PresenceDependencies } from './hive-runtime-cloud-presence-support'
import type { HiveRuntimeCloudRegistrationState } from './hive-runtime-cloud-state-store'

const ids = [
  '323e4567-e89b-42d3-a456-426614174000',
  '423e4567-e89b-42d3-a456-426614174000',
  '523e4567-e89b-42d3-a456-426614174000'
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

const claimedState = (authorityId: string | undefined = authorization.authorityId) =>
  ({
    schemaVersion: 1,
    runtimeRecordId: '723e4567-e89b-42d3-a456-426614174000',
    status: 'CLAIMED',
    ownerAccountId: authorization.accountId,
    ...(authorityId ? { authorityId } : {}),
    resourceVersion: 2,
    authorityGeneration: 1,
    fencingEpoch: 1,
    latestLeaseEpoch: 0
  }) satisfies HiveRuntimeCloudRegistrationState

afterEach(() => vi.restoreAllMocks())

function fixture(initialState: HiveRuntimeCloudRegistrationState | null) {
  let stored = initialState
  let nextId = 0
  const saveState = vi.fn((_path: string, state: HiveRuntimeCloudRegistrationState) => {
    stored = state
    return true
  })
  const client = {
    lookup: vi.fn().mockImplementation(async () =>
      stored?.status === 'CLAIMED'
        ? {
            exists: true,
            runtimeRecordId: stored.runtimeRecordId,
            status: 'CLAIMED',
            resourceVersion: stored.resourceVersion,
            authorityGeneration: stored.authorityGeneration,
            fencingEpoch: stored.fencingEpoch,
            latestLeaseEpoch: stored.latestLeaseEpoch,
            identityPublicKeySha256: createHash('sha256')
              .update(Buffer.from(identity.publicKey, 'base64url'))
              .digest('hex')
          }
        : { exists: false }
    ),
    register: vi.fn(),
    claim: vi.fn(),
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
      leaseExpiresAt: Date.parse('2026-08-25T08:01:30.000Z'),
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

async function startClaimed(service: HiveRuntimeCloudPresenceService): Promise<void> {
  service.setRuntimeReady(true)
  await vi.waitFor(() => expect(service.getState()).toBe('ONLINE'))
}

describe('Hive Runtime Cloud Presence service', () => {
  it('keeps an identity-backed claimed Runtime online after account sign-out', async () => {
    const { service, client } = fixture(claimedState())

    await startClaimed(service)
    service.setAuthorization(null)

    expect(service.getState()).toBe('ONLINE')
    expect(client.register).not.toHaveBeenCalled()
    expect(client.claim).not.toHaveBeenCalled()
    expect(client.heartbeat).toHaveBeenCalledOnce()
    expect(service.getCurrentLeaseContext()).toMatchObject({
      authorityId: authorization.authorityId,
      tuple: { runtimeRecordId: claimedState().runtimeRecordId }
    })
    await service.stop()
  })

  it('never registers or Claims an unclaimed Runtime during startup', async () => {
    const { service, client } = fixture(null)

    service.setAuthorization(authorization)
    service.setRuntimeReady(true)
    await vi.waitFor(() => expect(service.getState()).toBe('CLAIM_PENDING'))

    expect(client.register).not.toHaveBeenCalled()
    expect(client.claim).not.toHaveBeenCalled()
    expect(client.acquireLease).not.toHaveBeenCalled()
    await service.stop()
  })

  it('migrates a legacy claimed state when the owner next signs in', async () => {
    const { service, saveState } = fixture(claimedState(''))
    service.setRuntimeReady(true)
    await vi.waitFor(() => expect(service.getState()).toBe('CLAIM_PENDING'))

    service.setAuthorization(authorization)
    await vi.waitFor(() => expect(service.getState()).toBe('ONLINE'))

    expect(saveState).toHaveBeenCalledWith(
      'C:\\user-data',
      expect.objectContaining({ authorityId: authorization.authorityId })
    )
    await service.stop()
  })

  it('aborts an in-flight identity activation when the Runtime stops', async () => {
    const { service, client } = fixture(claimedState())
    let signal: AbortSignal | undefined
    client.lookup.mockImplementation(
      (_request: unknown, requestSignal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal = requestSignal
          requestSignal.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true
          })
        })
    )
    service.setRuntimeReady(true)
    await vi.waitFor(() => expect(client.lookup).toHaveBeenCalledOnce())

    service.setRuntimeReady(false)

    expect(signal?.aborted).toBe(true)
    expect(service.getState()).toBe('WAITING_RUNTIME')
    await service.stop()
  })

  it('rotates boot before reacquiring a previous lease tuple', async () => {
    const previous = { ...claimedState(), latestLeaseEpoch: 7 }
    const { service, client } = fixture(previous)
    client.lookup.mockResolvedValue({
      exists: true,
      runtimeRecordId: previous.runtimeRecordId,
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

    await startClaimed(service)

    expect(client.acquireLease.mock.calls[0]?.[0]).toMatchObject({
      expectedAuthorityGeneration: 3,
      expectedLeaseEpoch: 7,
      expectedFencingEpoch: 5,
      bootId: '423e4567-e89b-42d3-a456-426614174000'
    })
    await service.stop()
  })
})
