import { createHash, generateKeyPairSync } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type { HiveRuntimeCloudAuthorization } from '../hive-account/hive-account-service'
import { HiveRuntimeCloudRequestError } from './hive-runtime-cloud-client'
import type { HiveRuntimeCloudIdentity } from './hive-runtime-cloud-identity-store'
import type { HiveRuntimeCloudReport } from './hive-runtime-cloud-proof'
import { LocalRuntimeOwnershipService } from './local-runtime-ownership-service'
import type { HiveRuntimeCloudRegistrationState } from './hive-runtime-cloud-state-store'

const { privateKey, publicKey } = generateKeyPairSync('ed25519')
const identity: HiveRuntimeCloudIdentity = {
  schemaVersion: 1,
  runtimeInstanceId: '123e4567-e89b-42d3-a456-426614174000',
  privateKeyPkcs8: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
  publicKey: (publicKey.export({ format: 'jwk' }) as { x: string }).x,
  createdAt: 1
}
const identityDigest = createHash('sha256')
  .update(Buffer.from(identity.publicKey, 'base64url'))
  .digest('hex')
const authorization: HiveRuntimeCloudAuthorization = {
  accessToken: 'account-access-token',
  accountId: '223e4567-e89b-42d3-a456-426614174000',
  authorityId: 'hive-primary',
  sessionExpiresAt: 2_000,
  sessionGeneration: 1
}
const report = {
  runtimeVersion: '1.5.0',
  runtimeProtocolVersion: 3,
  capabilities: ['pairing-v3'],
  readiness: 'READY',
  readinessReasonCode: 'healthy',
  startedAt: '2026-08-31T00:00:00.000Z',
  connectionCapabilities: ['orca-direct']
} satisfies HiveRuntimeCloudReport

const switchedAuthorization: HiveRuntimeCloudAuthorization = {
  ...authorization,
  accessToken: 'switched-account-access-token',
  accountId: '323e4567-e89b-42d3-a456-426614174000',
  sessionGeneration: 2
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function fixture() {
  let stored: HiveRuntimeCloudRegistrationState | null = null
  const onRegistrationChanged = vi.fn()
  const clearIdentity = vi.fn()
  const clearState = vi.fn(() => {
    stored = null
  })
  const client = {
    getAuthorityId: vi.fn().mockResolvedValue(authorization.authorityId),
    lookup: vi.fn().mockResolvedValue({ exists: false }),
    register: vi.fn().mockResolvedValue({
      runtimeRecordId: '723e4567-e89b-42d3-a456-426614174000',
      runtimeInstanceId: identity.runtimeInstanceId,
      status: 'PENDING_CLAIM',
      claimCapability: 'c'.repeat(64),
      claimExpiresAt: 1_900,
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
      credentialActivationToken: 'secret'.repeat(8),
      credentialActivationExpiresAt: 1_900
    }),
    getOwnedRuntime: vi.fn(),
    reissueClaimCapability: vi.fn().mockResolvedValue({
      runtimeRecordId: '723e4567-e89b-42d3-a456-426614174000',
      claimCapability: 'r'.repeat(64),
      claimExpiresAt: 1_900,
      resourceVersion: 2
    }),
    reconcileClaim: vi.fn().mockResolvedValue({
      runtimeRecordId: '723e4567-e89b-42d3-a456-426614174000',
      runtimeInstanceId: identity.runtimeInstanceId,
      status: 'CLAIMED',
      authorityGeneration: 1,
      fencingEpoch: 1,
      latestLeaseEpoch: 0,
      resourceVersion: 2,
      clientAuthMode: 'IDENTITY_PROOF'
    }),
    createClaimChallenge: vi.fn().mockResolvedValue({
      challengeId: '823e4567-e89b-42d3-a456-426614174000',
      userCode: 'ABCD-EFGH',
      deviceCode: 'd'.repeat(43),
      verificationUri: 'https://code.hivekernel.com/runtime/claim',
      expiresAt: 1_900,
      pollIntervalSeconds: 5
    }),
    pollClaimChallenge: vi.fn().mockResolvedValue({
      status: 'APPROVED',
      runtime: {
        runtimeRecordId: '723e4567-e89b-42d3-a456-426614174000',
        runtimeInstanceId: identity.runtimeInstanceId,
        status: 'CLAIMED',
        authorityGeneration: 1,
        fencingEpoch: 1,
        latestLeaseEpoch: 0,
        resourceVersion: 2,
        clientAuthMode: 'IDENTITY_PROOF'
      }
    })
  }
  const service = new LocalRuntimeOwnershipService({
    config: { enabled: true, apiBaseUrl: 'https://api.hivekernel.com' },
    userDataPath: 'C:\\user-data',
    getReport: () => report,
    getBootId: () => '323e4567-e89b-42d3-a456-426614174000',
    onRegistrationChanged,
    dependencies: {
      createClient: () => client,
      loadIdentity: () => ({ status: 'ok', identity }),
      readState: () => (stored ? { status: 'ok', value: stored } : { status: 'missing' }),
      saveState: (_path, state) => {
        stored = state
        return true
      },
      clearIdentity,
      clearState,
      randomUuid: () => '423e4567-e89b-42d3-a456-426614174000',
      now: () => 1_000
    }
  })
  return {
    service,
    client,
    getStored: () => stored,
    setStored: (state: HiveRuntimeCloudRegistrationState | null) => {
      stored = state
    },
    clearIdentity,
    clearState,
    onRegistrationChanged
  }
}

describe('LocalRuntimeOwnershipService', () => {
  it('only probes on account sign-in and leaves an unregistered Runtime untouched', async () => {
    const { service, client, getStored } = fixture()

    service.setAuthorization(authorization)
    await vi.waitFor(() => expect(service.getState().relation).toBe('UNREGISTERED'))

    expect(client.lookup).toHaveBeenCalledOnce()
    expect(client.register).not.toHaveBeenCalled()
    expect(client.claim).not.toHaveBeenCalled()
    expect(getStored()).toBeNull()
    service.stop()
  })

  it('registers and Claims only after the explicit local action', async () => {
    const { service, client, getStored, onRegistrationChanged } = fixture()
    service.setAuthorization(authorization)
    await vi.waitFor(() => expect(service.getState().relation).toBe('UNREGISTERED'))

    const result = await service.claimLocalRuntime(authorization.accountId)

    expect(result.relation).toBe('CLAIMED_BY_CURRENT')
    expect(client.register).toHaveBeenCalledOnce()
    expect(client.claim).toHaveBeenCalledWith(
      expect.objectContaining({ claimCapability: 'c'.repeat(64) }),
      authorization.accessToken,
      expect.any(String),
      expect.any(AbortSignal)
    )
    expect(getStored()).toMatchObject({
      status: 'CLAIMED',
      authorityId: authorization.authorityId
    })
    expect(getStored()).not.toHaveProperty('ownerAccountId')
    expect(getStored()).not.toHaveProperty('claimCapability')
    expect(onRegistrationChanged).toHaveBeenCalledOnce()
    service.stop()
  })

  it('rejects a claim when the active authorization no longer matches the renderer account', async () => {
    const { service, client } = fixture()
    service.setAuthorization(authorization)
    await vi.waitFor(() => expect(service.getState().relation).toBe('UNREGISTERED'))
    const stateBeforeClaim = service.getState()

    await expect(service.claimLocalRuntime('323e4567-e89b-42d3-a456-426614174000')).rejects.toThrow(
      'hive_runtime_cloud_account_changed'
    )

    expect(client.register).not.toHaveBeenCalled()
    expect(client.claim).not.toHaveBeenCalled()
    expect(service.getState()).toBe(stateBeforeClaim)
    service.stop()
  })

  it('does not publish a completed claim for an authorization replaced before the outer continuation', async () => {
    const { service, client, onRegistrationChanged } = fixture()
    service.setAuthorization(authorization)
    await vi.waitFor(() => expect(service.getState().relation).toBe('UNREGISTERED'))
    const observed = [] as ReturnType<typeof service.getState>[]
    const unsubscribe = service.subscribe((state) => observed.push(state))
    const claimResult = {
      runtime: {
        runtimeRecordId: '723e4567-e89b-42d3-a456-426614174000',
        runtimeInstanceId: identity.runtimeInstanceId,
        ownerAccountId: authorization.accountId,
        status: 'CLAIMED' as const,
        authorityGeneration: 1,
        fencingEpoch: 1,
        resourceVersion: 2
      },
      credentialActivationToken: 'secret'.repeat(8),
      credentialActivationExpiresAt: 1_900
    }
    const claim = deferred<typeof claimResult>()
    client.claim.mockReturnValueOnce(claim.promise)

    const pendingClaim = service.claimLocalRuntime(authorization.accountId)
    await vi.waitFor(() => expect(client.claim).toHaveBeenCalledOnce())
    claim.resolve(claimResult)
    queueMicrotask(() => service.setAuthorization(switchedAuthorization))

    const result = await pendingClaim
    await vi.waitFor(() =>
      expect(service.getState()).toMatchObject({
        accountId: switchedAuthorization.accountId,
        sessionGeneration: switchedAuthorization.sessionGeneration,
        relation: 'UNREGISTERED'
      })
    )
    const switchedIndex = observed.findIndex(
      (state) => state.accountId === switchedAuthorization.accountId
    )
    expect(switchedIndex).toBeGreaterThanOrEqual(0)
    expect(observed.slice(switchedIndex)).not.toContainEqual(
      expect.objectContaining({ accountId: authorization.accountId })
    )
    expect(result.accountId).toBe(switchedAuthorization.accountId)
    expect(onRegistrationChanged).toHaveBeenCalledOnce()
    unsubscribe()
    service.stop()
  })

  it('keeps a committed claim successful when the registration observer throws', async () => {
    const { service, onRegistrationChanged } = fixture()
    service.setAuthorization(authorization)
    await vi.waitFor(() => expect(service.getState().relation).toBe('UNREGISTERED'))
    onRegistrationChanged.mockImplementationOnce(() => {
      throw new Error('observer_failed')
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    try {
      await expect(service.claimLocalRuntime(authorization.accountId)).resolves.toMatchObject({
        relation: 'CLAIMED_BY_CURRENT',
        accountId: authorization.accountId
      })
      expect(service.getState()).toMatchObject({
        relation: 'CLAIMED_BY_CURRENT',
        errorCode: null
      })
      expect(onRegistrationChanged).toHaveBeenCalledOnce()
      expect(warn).toHaveBeenCalledOnce()
    } finally {
      warn.mockRestore()
      service.stop()
    }
  })

  it('does not publish stale analysis after authorization changes at the await boundary', async () => {
    const { service, client } = fixture()
    const lookup = deferred<{ exists: false }>()
    client.lookup.mockReturnValueOnce(lookup.promise)
    const observed = [] as ReturnType<typeof service.getState>[]
    const unsubscribe = service.subscribe((state) => observed.push(state))

    service.setAuthorization(authorization)
    await vi.waitFor(() => expect(client.lookup).toHaveBeenCalledOnce())
    let existsReads = 0
    lookup.resolve({
      get exists() {
        existsReads += 1
        if (existsReads === 2) {
          queueMicrotask(() => service.setAuthorization(switchedAuthorization))
        }
        return false as const
      }
    })

    await vi.waitFor(() =>
      expect(service.getState()).toMatchObject({
        accountId: switchedAuthorization.accountId,
        sessionGeneration: switchedAuthorization.sessionGeneration,
        relation: 'UNREGISTERED'
      })
    )
    const switchedIndex = observed.findIndex(
      (state) => state.accountId === switchedAuthorization.accountId
    )
    expect(switchedIndex).toBeGreaterThanOrEqual(0)
    expect(observed.slice(switchedIndex)).not.toContainEqual(
      expect.objectContaining({ accountId: authorization.accountId })
    )
    unsubscribe()
    service.stop()
  })

  it('reports another owner without exposing account identity', async () => {
    const { service, client } = fixture()
    client.lookup.mockResolvedValue({
      exists: true,
      runtimeRecordId: '723e4567-e89b-42d3-a456-426614174000',
      status: 'CLAIMED',
      resourceVersion: 2,
      authorityGeneration: 1,
      fencingEpoch: 1,
      latestLeaseEpoch: 0,
      identityPublicKeySha256: identityDigest
    })
    client.getOwnedRuntime.mockRejectedValue(new HiveRuntimeCloudRequestError(404, null))

    service.setAuthorization(authorization)
    await vi.waitFor(() => expect(service.getState().relation).toBe('CLAIMED_BY_OTHER'))

    expect(service.getState()).toMatchObject({
      accountId: authorization.accountId,
      errorCode: 'CLAIMED_BY_OTHER'
    })
    service.stop()
  })

  it('keeps claim relation and error code consistent when ownership disappears from the account', async () => {
    const { service, client } = fixture()
    service.setAuthorization(authorization)
    await vi.waitFor(() => expect(service.getState().relation).toBe('UNREGISTERED'))
    client.claim.mockRejectedValue(new HiveRuntimeCloudRequestError(404, null))

    await expect(service.claimLocalRuntime(authorization.accountId)).rejects.toMatchObject({
      status: 404
    })

    expect(service.getState()).toMatchObject({
      relation: 'CLAIMED_BY_OTHER',
      errorCode: 'CLAIMED_BY_OTHER'
    })
    service.stop()
  })

  it('requests step-up only for the server claim step-up category', async () => {
    const { service, client } = fixture()
    service.setAuthorization(authorization)
    await vi.waitFor(() => expect(service.getState().relation).toBe('UNREGISTERED'))
    client.claim.mockRejectedValue(
      new HiveRuntimeCloudRequestError(403, 'runtime_claim_step_up_required')
    )

    await expect(service.claimLocalRuntime(authorization.accountId)).rejects.toMatchObject({
      status: 403
    })

    expect(service.getState()).toMatchObject({
      relation: 'UNVERIFIABLE',
      errorCode: 'STEP_UP_REQUIRED'
    })
    service.stop()
  })

  it('does not turn unrelated forbidden claim failures into a step-up prompt', async () => {
    const { service, client } = fixture()
    service.setAuthorization(authorization)
    await vi.waitFor(() => expect(service.getState().relation).toBe('UNREGISTERED'))
    client.claim.mockRejectedValue(new HiveRuntimeCloudRequestError(403, 'insufficient_scope'))

    await expect(service.claimLocalRuntime(authorization.accountId)).rejects.toMatchObject({
      status: 403
    })

    expect(service.getState()).toMatchObject({
      relation: 'UNVERIFIABLE',
      errorCode: 'insufficient_scope'
    })
    service.stop()
  })

  it('reissues a lost one-time capability only after the explicit Claim action', async () => {
    const { service, client } = fixture()
    client.lookup.mockResolvedValue({
      exists: true,
      runtimeRecordId: '723e4567-e89b-42d3-a456-426614174000',
      status: 'PENDING_CLAIM',
      resourceVersion: 1,
      authorityGeneration: 1,
      fencingEpoch: 1,
      latestLeaseEpoch: 0,
      identityPublicKeySha256: identityDigest
    })
    service.setAuthorization(authorization)
    await vi.waitFor(() => expect(service.getState().relation).toBe('PENDING_CLAIM'))

    await service.claimLocalRuntime(authorization.accountId)

    expect(client.reissueClaimCapability).toHaveBeenCalledOnce()
    expect(client.claim).toHaveBeenCalledWith(
      expect.objectContaining({ claimCapability: 'r'.repeat(64), expectedVersion: 2 }),
      authorization.accessToken,
      expect.any(String),
      expect.any(AbortSignal)
    )
    service.stop()
  })

  it('reconciles a claimed local identity through the current owner session', async () => {
    const { service, client, getStored } = fixture()
    client.lookup.mockResolvedValue({
      exists: true,
      runtimeRecordId: '723e4567-e89b-42d3-a456-426614174000',
      status: 'CLAIMED',
      resourceVersion: 2,
      authorityGeneration: 1,
      fencingEpoch: 1,
      latestLeaseEpoch: 0,
      identityPublicKeySha256: identityDigest
    })
    client.getOwnedRuntime.mockResolvedValue({
      runtimeRecordId: '723e4567-e89b-42d3-a456-426614174000'
    })
    service.setAuthorization(authorization)
    await vi.waitFor(() => expect(service.getState().relation).toBe('CLAIMED_BY_CURRENT'))

    await service.claimLocalRuntime(authorization.accountId)

    expect(client.reconcileClaim).toHaveBeenCalledWith(
      '723e4567-e89b-42d3-a456-426614174000',
      expect.objectContaining({
        proof: expect.objectContaining({
          protocolVersion: 'hive-runtime-claim-reconcile/v1'
        })
      }),
      authorization.accessToken,
      expect.any(AbortSignal)
    )
    expect(getStored()).not.toHaveProperty('ownerAccountId')
    service.stop()
  })

  it('clears account-scoped ownership state on sign-out without deleting local state', async () => {
    const { service, getStored } = fixture()
    service.setAuthorization(authorization)
    await vi.waitFor(() => expect(service.getState().relation).toBe('UNREGISTERED'))

    service.setAuthorization(null)

    expect(service.getState()).toMatchObject({ accountId: null, sessionGeneration: null })
    expect(getStored()).toBeNull()
    service.stop()
  })

  it('publishes the same strictly increasing state revision returned by getState', () => {
    const { service } = fixture()
    const observed: number[] = []
    const unsubscribe = service.subscribe((state) => observed.push(state.stateRevision))

    service.setPresenceState('ONLINE')

    expect(observed).toEqual([0, 1])
    expect(service.getState().stateRevision).toBe(1)
    unsubscribe()
    service.stop()
  })

  it('does not deliver an older outer state after a listener publishes a newer state', () => {
    const { service } = fixture()
    let reentered = false
    const unsubscribeFirst = service.subscribe((state) => {
      if (!reentered && state.presence === 'ONLINE') {
        reentered = true
        service.setPresenceState('OFFLINE_RETRY')
      }
    })
    const observedBySecond: string[] = []
    const unsubscribeSecond = service.subscribe((state) => observedBySecond.push(state.presence))
    observedBySecond.length = 0

    service.setPresenceState('ONLINE')

    expect(observedBySecond).toEqual(['OFFLINE_RETRY'])
    expect(service.getState().presence).toBe('OFFLINE_RETRY')
    unsubscribeSecond()
    unsubscribeFirst()
    service.stop()
  })

  it('uses a public authority document and device-code approval for headless claim', async () => {
    const { service, client, getStored } = fixture()

    const started = await service.beginHeadlessClaim()
    expect(started).toMatchObject({
      status: 'PENDING',
      challengeId: '823e4567-e89b-42d3-a456-426614174000',
      userCode: 'ABCD-EFGH'
    })
    expect(client.getAuthorityId).toHaveBeenCalledOnce()
    expect(client.createClaimChallenge).toHaveBeenCalledWith(
      expect.objectContaining({
        runtimeRecordId: '723e4567-e89b-42d3-a456-426614174000',
        proof: expect.objectContaining({ authorityId: authorization.authorityId })
      }),
      expect.any(AbortSignal)
    )

    const result = await service.pollHeadlessClaim('823e4567-e89b-42d3-a456-426614174000')
    expect(result).toEqual({
      status: 'CLAIMED',
      runtimeRecordId: '723e4567-e89b-42d3-a456-426614174000'
    })
    expect(getStored()).toMatchObject({
      status: 'CLAIMED',
      authorityId: authorization.authorityId
    })
    expect(getStored()).not.toHaveProperty('ownerAccountId')
    service.stop()
  })

  it('does not let a completed headless poll mutate ownership after its observer stops the service', async () => {
    const { service, onRegistrationChanged } = fixture()
    const started = await service.beginHeadlessClaim()
    const stateRevisionBeforePoll = service.getState().stateRevision
    onRegistrationChanged.mockImplementationOnce(() => service.stop())

    await expect(service.pollHeadlessClaim(started.challengeId)).resolves.toMatchObject({
      status: 'CLAIMED'
    })

    expect(service.getState().stateRevision).toBe(stateRevisionBeforePoll)
  })

  it('binds a headless challenge to the reissued pending revision', async () => {
    const { service, client } = fixture()
    client.lookup.mockResolvedValue({
      exists: true,
      runtimeRecordId: '723e4567-e89b-42d3-a456-426614174000',
      status: 'PENDING_CLAIM',
      resourceVersion: 1,
      authorityGeneration: 1,
      fencingEpoch: 1,
      latestLeaseEpoch: 0,
      identityPublicKeySha256: identityDigest
    })

    await service.beginHeadlessClaim()

    expect(client.reissueClaimCapability).toHaveBeenCalledOnce()
    expect(client.createClaimChallenge).toHaveBeenCalledWith(
      expect.objectContaining({
        runtimeRecordId: '723e4567-e89b-42d3-a456-426614174000',
        expectedVersion: 2
      }),
      expect.any(AbortSignal)
    )
    service.stop()
  })

  it('reports local status and resets only the Cloud identity state', () => {
    const { service, setStored, clearIdentity, clearState } = fixture()
    setStored({
      schemaVersion: 1,
      runtimeRecordId: '723e4567-e89b-42d3-a456-426614174000',
      status: 'CLAIMED',
      authorityId: authorization.authorityId,
      resourceVersion: 2,
      authorityGeneration: 1,
      fencingEpoch: 1,
      latestLeaseEpoch: 0
    })

    expect(service.getLocalRuntimeStatus()).toMatchObject({
      ownership: 'CLAIMED',
      runtimeRecordId: '723e4567-e89b-42d3-a456-426614174000',
      relay: 'offline'
    })
    expect(service.resetCloudIdentity()).toEqual({ reset: true })
    expect(clearState).toHaveBeenCalledOnce()
    expect(clearIdentity).toHaveBeenCalledOnce()
    expect(service.getLocalRuntimeStatus()).toMatchObject({
      ownership: 'UNREGISTERED',
      runtimeRecordId: null
    })
    service.stop()
  })
})
