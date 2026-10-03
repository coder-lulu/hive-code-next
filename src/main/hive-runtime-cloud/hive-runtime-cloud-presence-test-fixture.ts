import { createHash, generateKeyPairSync } from 'node:crypto'
import { vi, type Mock } from 'vitest'
import type { HiveRuntimeCloudAuthorization } from '../hive-account/hive-account-service'
import type { HiveRuntimeCloudIdentity } from './hive-runtime-cloud-identity-store'
import type { HiveRuntimeCloudReport } from './hive-runtime-cloud-proof'
import { HiveRuntimeCloudPresenceService } from './hive-runtime-cloud-presence-service'
import type { PresenceDependencies } from './hive-runtime-cloud-presence-support'
import type { HiveRuntimeCloudRegistrationState } from './hive-runtime-cloud-state-store'

export const ids = [
  '323e4567-e89b-42d3-a456-426614174000',
  '423e4567-e89b-42d3-a456-426614174000',
  '523e4567-e89b-42d3-a456-426614174000'
]
const { privateKey, publicKey } = generateKeyPairSync('ed25519')
const identityPublicKey = publicKey.export({ format: 'jwk' }).x
if (!identityPublicKey) {
  throw new Error('test_identity_public_key_unavailable')
}
export const identity: HiveRuntimeCloudIdentity = {
  schemaVersion: 1,
  runtimeInstanceId: '123e4567-e89b-42d3-a456-426614174000',
  privateKeyPkcs8: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
  publicKey: identityPublicKey,
  createdAt: 1
}
export const authorization: HiveRuntimeCloudAuthorization = {
  accessToken: `e30.${Buffer.from(
    JSON.stringify({
      sub: '223e4567-e89b-42d3-a456-426614174000',
      session_id: '923e4567-e89b-42d3-a456-426614174000',
      authority_id: 'hive-primary',
      exp: Date.parse('2028-08-26T00:00:00.000Z') / 1_000
    })
  ).toString('base64url')}.test-signature`,
  accountId: '223e4567-e89b-42d3-a456-426614174000',
  authorityId: 'hive-primary',
  sessionExpiresAt: Date.parse('2028-08-26T00:00:00.000Z'),
  sessionGeneration: 1
}
export function refreshedAuthorization(cloudSessionId = '923e4567-e89b-42d3-a456-426614174000') {
  const payload = {
    sub: authorization.accountId,
    authority_id: authorization.authorityId,
    session_id: cloudSessionId,
    exp: authorization.sessionExpiresAt / 1_000
  }
  return {
    ...authorization,
    sessionGeneration: 2,
    accessToken: `e30.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.refreshed-signature`
  }
}
export const report = {
  runtimeVersion: '1.4.178-rc.7',
  runtimeProtocolVersion: 3 as const,
  capabilities: ['pairing-v3', 'runtime-health-v1'],
  readiness: 'READY' as const,
  readinessReasonCode: 'healthy',
  startedAt: '2026-08-25T07:59:00.000Z',
  connectionCapabilities: ['orca-direct']
} satisfies HiveRuntimeCloudReport

export const claimedState = (authorityId: string | undefined = authorization.authorityId) =>
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

type PresenceFixture = {
  service: HiveRuntimeCloudPresenceService
  client: {
    lookup: Mock
    register: Mock
    claim: Mock
    acquireLease: Mock
    heartbeat: Mock
  }
  saveState: Mock<(_path: string, state: HiveRuntimeCloudRegistrationState) => boolean>
}

export function fixture(
  initialState: HiveRuntimeCloudRegistrationState | null,
  random: () => number = () => 0,
  now: () => number = () => Date.parse('2026-08-25T08:00:00.000Z'),
  initialAuthorization: HiveRuntimeCloudAuthorization | null = authorization
): PresenceFixture {
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
    now,
    random
  }
  const service = new HiveRuntimeCloudPresenceService(
    { enabled: true, apiBaseUrl: 'https://api.hivekernel.com' },
    'C:\\user-data',
    { getReport: () => report },
    dependencies
  )
  service.setAuthorization(initialAuthorization)
  return { service, client, saveState }
}
