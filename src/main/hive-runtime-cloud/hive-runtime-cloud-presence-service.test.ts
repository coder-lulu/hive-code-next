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

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function fixture(
  initialState: HiveRuntimeCloudRegistrationState | null,
  random: () => number = () => 0
) {
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
    random
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
  it('immediately coalesces relay heartbeat requests without concurrent sends or sequence reuse', async () => {
    const { service, client } = fixture(claimedState())
    await startClaimed(service)
    const baseResponse = await client.heartbeat.mock.results[0].value
    let release: (() => void) | undefined
    let active = 0
    let maximumActive = 0
    client.heartbeat.mockImplementation(async (request: { heartbeatSeq: number }) => {
      active++
      maximumActive = Math.max(maximumActive, active)
      if (request.heartbeatSeq === 2) {
        await new Promise<void>((resolve) => {
          release = resolve
        })
      }
      active--
      return {
        ...baseResponse,
        acceptedHeartbeatSeq: request.heartbeatSeq,
        responseVersion: 'runtime-session-control/v1',
        ackedSessionTransitionSequence: 0,
        sessionTransitionResults: [],
        sessionAuthorityUntil: null,
        ackedControlSequence: 0,
        controlCommands: [],
        nextControlSequence: 1
      }
    })
    const accept = vi.fn()
    service.setRelayHeartbeatContributor({
      snapshot: () => ({
        advertiseRelay: true,
        relayControl: {
          assignmentId: '22000000-0000-4000-8000-000000000001',
          cellId: 'cell-1',
          cellIncarnationId: '22000000-0000-4000-8000-000000000002',
          assignmentEpoch: 1,
          controlGeneration: 1,
          controlConnectionAcknowledged: true,
          controlCommandAck: null,
          sessionTransitions: []
        }
      }),
      accept
    })
    service.requestHeartbeat()
    service.requestHeartbeat()
    expect(client.heartbeat).toHaveBeenCalledTimes(2)
    release!()
    await vi.waitFor(() => expect(client.heartbeat).toHaveBeenCalledTimes(3))
    expect(client.heartbeat.mock.calls.map((call) => call[0]?.heartbeatSeq)).toEqual([1, 2, 3])
    expect(maximumActive).toBe(1)
    expect(accept).toHaveBeenCalledTimes(2)
    expect(accept.mock.calls[0][2].assignmentEpoch).toBe(1)
    await service.stop()
  })

  it('spreads the initial activation after the Runtime becomes ready', async () => {
    vi.useFakeTimers()
    const { service, client } = fixture(claimedState(), () => 0.5)

    service.setRuntimeReady(true)
    await vi.advanceTimersByTimeAsync(7_499)
    expect(client.lookup).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(client.lookup).toHaveBeenCalledOnce()
    await service.stop()
  })

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
