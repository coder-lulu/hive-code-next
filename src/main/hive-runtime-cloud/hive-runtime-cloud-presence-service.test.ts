import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HiveRuntimeCloudClient, HiveRuntimeCloudRequestError } from './hive-runtime-cloud-client'
import type { HiveRuntimeCloudPresenceService } from './hive-runtime-cloud-presence-service'
import { HiveRuntimeCloudWebLaunchService } from './hive-runtime-cloud-web-launch-service'
import {
  ids,
  identity,
  authorization,
  claimedState,
  fixture,
  refreshedAuthorization
} from './hive-runtime-cloud-presence-test-fixture'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

async function startClaimed(service: HiveRuntimeCloudPresenceService): Promise<void> {
  service.setRuntimeReady(true)
  await vi.waitFor(() => expect(service.getState()).toBe('ONLINE'))
}

describe('Hive Runtime Cloud Presence service', () => {
  it('recovers automatically from a response body transport interruption', async () => {
    const http = new HiveRuntimeCloudClient(
      'https://test.invalid',
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new DOMException('body interrupted', 'AbortError'))
            }
          })
        )
    )
    const failure = await http.lookup({}).catch((error: unknown) => error)
    vi.useFakeTimers()
    const { service, client } = fixture(claimedState())
    try {
      service.setRuntimeReady(true)
      await vi.advanceTimersByTimeAsync(0)
      expect(service.getState()).toBe('ONLINE')
      client.heartbeat.mockRejectedValueOnce(failure).mockResolvedValueOnce({
        ...(await client.heartbeat.mock.results[0]!.value),
        acceptedHeartbeatSeq: 2
      })
      await vi.advanceTimersByTimeAsync(27_000)
      expect(service.getState()).toBe('OFFLINE_RETRY')
      expect(service.getCurrentLeaseContext()).toBeNull()
      await vi.advanceTimersByTimeAsync(1000)
      expect(service.getState()).toBe('ONLINE')
      expect(client.heartbeat).toHaveBeenCalledTimes(3)
    } finally {
      await service.stop()
    }
  })

  it.each([500, 502, 504])(
    'recovers automatically after temporary heartbeat HTTP %s',
    async (status) => {
      vi.useFakeTimers()
      const { service, client } = fixture(claimedState())
      try {
        service.setRuntimeReady(true)
        await vi.advanceTimersByTimeAsync(0)
        expect(service.getState()).toBe('ONLINE')
        client.heartbeat
          .mockRejectedValueOnce(new HiveRuntimeCloudRequestError(status, null, 2000))
          .mockResolvedValueOnce({
            ...(await client.heartbeat.mock.results[0]!.value),
            acceptedHeartbeatSeq: 2
          })
        await vi.advanceTimersByTimeAsync(27_000)
        expect(service.getState()).toBe('OFFLINE_RETRY')
        expect(service.getCurrentLeaseContext()).toBeNull()
        expect(client.heartbeat).toHaveBeenCalledTimes(2)
        await vi.advanceTimersByTimeAsync(1999)
        expect(client.heartbeat).toHaveBeenCalledTimes(2)
        await vi.advanceTimersByTimeAsync(1)
        expect(service.getState()).toBe('ONLINE')
        expect(client.heartbeat).toHaveBeenCalledTimes(3)
      } finally {
        await service.stop()
      }
    }
  )

  it.each([409, 410])(
    'reconciles a changed lease tuple after activation returns %s',
    async (status) => {
      vi.useFakeTimers()
      const { service, client } = fixture(claimedState())
      client.acquireLease.mockRejectedValueOnce(new HiveRuntimeCloudRequestError(status, null))
      service.setRuntimeReady(true)
      await vi.advanceTimersByTimeAsync(0)
      expect(service.getState()).toBe('OFFLINE_RETRY')
      expect(client.heartbeat).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1_000)
      expect(client.lookup).toHaveBeenCalledTimes(2)
      expect(service.getState()).toBe('ONLINE')
      await service.stop()
    }
  )

  it('keeps an unauthorized activation fenced until registration explicitly changes', async () => {
    vi.useFakeTimers()
    const { service, client } = fixture(claimedState())
    client.acquireLease.mockRejectedValueOnce(new HiveRuntimeCloudRequestError(403, null))
    service.setRuntimeReady(true)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(service.getState()).toBe('FENCED')
    expect(client.acquireLease).toHaveBeenCalledOnce()
    service.notifyRegistrationChanged()
    await vi.advanceTimersByTimeAsync(0)
    expect(service.getState()).toBe('ONLINE')
    await service.stop()
  })

  it('renews short relay authority before expiry without immediate heartbeat feedback', async () => {
    vi.useFakeTimers()
    const { service, client } = fixture(claimedState(), () => 0.5, Date.now)
    service.setRuntimeReady(true)
    await vi.advanceTimersByTimeAsync(7_500)
    expect(service.getState()).toBe('ONLINE')
    const baseResponse = await client.heartbeat.mock.results[0].value
    let grantMs = 20_000
    client.heartbeat.mockImplementation(async (request: { heartbeatSeq: number }) => ({
      ...baseResponse,
      acceptedHeartbeatSeq: request.heartbeatSeq,
      responseVersion: 'runtime-session-control/v1',
      ackedSessionTransitionSequence: 0,
      sessionTransitionResults: [],
      sessionAuthorityUntil: Date.now() + grantMs,
      regionMeasurementWindow: null,
      ackedControlSequence: 0,
      controlCommands: [],
      nextControlSequence: 1
    }))
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
          sessionTransitions: [],
          activeConnectionCount: 0,
          regionSelectionMode: 'DYNAMIC',
          regionMeasurement: null
        }
      }),
      accept: vi.fn()
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(client.heartbeat).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(9_999)
    expect(client.heartbeat).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(client.heartbeat).toHaveBeenCalledTimes(3)
    // Renew repeatedly across several original deadlines, rather than dying at 30s.
    await vi.advanceTimersByTimeAsync(40_000)
    expect(client.heartbeat).toHaveBeenCalledTimes(7)
    grantMs = 1
    await vi.advanceTimersByTimeAsync(10_000)
    expect(client.heartbeat).toHaveBeenCalledTimes(8)
    await vi.advanceTimersByTimeAsync(999)
    expect(client.heartbeat).toHaveBeenCalledTimes(8)
    await vi.advanceTimersByTimeAsync(1)
    expect(client.heartbeat).toHaveBeenCalledTimes(9)
    await service.stop()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(client.heartbeat).toHaveBeenCalledTimes(9)
  })

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
        regionMeasurementWindow: null,
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
          sessionTransitions: [],
          activeConnectionCount: 0,
          regionSelectionMode: 'DYNAMIC',
          regionMeasurement: null
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

  it('stops heartbeats and removes Cloud access immediately after account sign-out', async () => {
    vi.useFakeTimers()
    const { service, client, saveState } = fixture(claimedState())
    service.setRuntimeReady(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(service.getState()).toBe('ONLINE')
    const listener = vi.fn()
    service.subscribeLeaseContext(listener)
    saveState.mockClear()
    service.setAuthorization(null)
    expect(service.getState()).toBe('SIGNED_OUT')
    expect(service.getCurrentLeaseContext()).toBeNull()
    expect(listener).toHaveBeenLastCalledWith(null)
    service.requestHeartbeat()
    service.notifyRegistrationChanged()
    service.setRuntimeReady(false)
    service.setRuntimeReady(true)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(client.register).not.toHaveBeenCalled()
    expect(client.claim).not.toHaveBeenCalled()
    expect(client.heartbeat).toHaveBeenCalledOnce()
    expect(client.acquireLease).toHaveBeenCalledOnce()
    expect(saveState).not.toHaveBeenCalled()
    await service.stop()
  })

  it('never activates a claimed Runtime until its owner signs in', async () => {
    vi.useFakeTimers()
    const { service, client } = fixture(claimedState(), () => 0, Date.now, null)
    service.setRuntimeReady(true)
    service.notifyRegistrationChanged()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(service.getState()).toBe('SIGNED_OUT')
    expect(client.lookup).not.toHaveBeenCalled()
    expect(client.acquireLease).not.toHaveBeenCalled()
    expect(client.heartbeat).not.toHaveBeenCalled()
    await service.stop()
  })

  it('rejects activation by a different account before any Cloud request', async () => {
    vi.useFakeTimers()
    const { service, client } = fixture({ ...claimedState(), ownerAccountId: ids[0] })
    service.setRuntimeReady(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(service.getState()).toBe('FENCED')
    expect(client.lookup).not.toHaveBeenCalled()
    expect(client.acquireLease).not.toHaveBeenCalled()
    expect(client.heartbeat).not.toHaveBeenCalled()
    await service.stop()
  })

  it('ignores activation that completes after sign-out and aborts its request', async () => {
    const { service, client, saveState } = fixture(claimedState())
    const lookupResponse = await client.lookup()
    client.lookup.mockClear()
    let resolveLookup: (value: unknown) => void = () => {}
    client.lookup.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveLookup = resolve
        })
    )
    service.setRuntimeReady(true)
    await vi.waitFor(() => expect(client.lookup).toHaveBeenCalledOnce())
    const signal = client.lookup.mock.calls[0]?.[1]
    service.setAuthorization(null)
    expect(signal?.aborted).toBe(true)
    resolveLookup(lookupResponse)
    await vi.waitFor(() => expect(service.getState()).toBe('SIGNED_OUT'))
    await service.stop()
    expect(client.acquireLease).not.toHaveBeenCalled()
    expect(client.heartbeat).not.toHaveBeenCalled()
    expect(saveState).not.toHaveBeenCalled()
  })

  it('discards a late heartbeat after sign-out and reactivates on a new login', async () => {
    const { service, client } = fixture(claimedState())
    await startClaimed(service)
    const base = await client.heartbeat.mock.results[0].value
    let resolveHeartbeat: (value: unknown) => void = () => {}
    client.heartbeat.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveHeartbeat = resolve
        })
    )
    service.requestHeartbeat()
    expect(client.heartbeat).toHaveBeenCalledTimes(2)
    service.setAuthorization(null)
    expect(client.heartbeat.mock.calls[1]?.[2]?.aborted).toBe(true)
    expect(service.getCurrentLeaseContext()).toBeNull()
    resolveHeartbeat({ ...base, acceptedHeartbeatSeq: 2 })
    await vi.waitFor(() => expect(service.getState()).toBe('SIGNED_OUT'))
    service.setAuthorization({ ...authorization, sessionGeneration: 2 })
    await vi.waitFor(() => expect(service.getState()).toBe('ONLINE'))
    expect(client.acquireLease).toHaveBeenCalledTimes(2)
    expect(client.heartbeat).toHaveBeenCalledTimes(3)
    expect(client.acquireLease.mock.calls[0]?.[1]).toBe(authorization.accessToken)
    expect(client.heartbeat.mock.calls[2]?.[0]?.cloudSessionId).toBe(
      '923e4567-e89b-42d3-a456-426614174000'
    )
    await service.stop()
  })

  it('uses the refreshed same-session token when lookup completes after token rotation', async () => {
    const { service, client } = fixture(claimedState())
    const response = await client.lookup()
    client.lookup.mockClear()
    let finishLookup: (value: unknown) => void = () => {}
    client.lookup.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishLookup = resolve
        })
    )
    service.setRuntimeReady(true)
    await vi.waitFor(() => expect(client.lookup).toHaveBeenCalledOnce())
    const refreshed = refreshedAuthorization()
    service.setAuthorization(refreshed)
    finishLookup(response)
    await vi.waitFor(() => expect(service.getState()).toBe('ONLINE'))
    expect(client.lookup).toHaveBeenCalledOnce()
    expect(client.acquireLease.mock.calls[0]?.[1]).toBe(refreshed.accessToken)
    await service.stop()
  })

  it('re-signs the same heartbeat once when an old-token 401 arrives after refresh', async () => {
    const { service, client } = fixture(claimedState())
    await startClaimed(service)
    const base = await client.heartbeat.mock.results[0].value
    let rejectHeartbeat: (reason: unknown) => void = () => {}
    client.heartbeat.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectHeartbeat = reject
        })
    )
    client.heartbeat.mockResolvedValueOnce({ ...base, acceptedHeartbeatSeq: 2 })
    service.requestHeartbeat()
    const refreshed = refreshedAuthorization()
    service.setAuthorization(refreshed)
    rejectHeartbeat(new HiveRuntimeCloudRequestError(401, null))
    await vi.waitFor(() => expect(client.heartbeat).toHaveBeenCalledTimes(3))
    expect(service.getState()).toBe('ONLINE')
    expect(client.acquireLease).toHaveBeenCalledOnce()
    const rejected = client.heartbeat.mock.calls[1]
    const accepted = client.heartbeat.mock.calls[2]
    expect(accepted[1]).toBe(refreshed.accessToken)
    expect(accepted[0].heartbeatSeq).toBe(rejected[0].heartbeatSeq)
    expect(accepted[0].proof.bodySha256).toBe(rejected[0].proof.bodySha256)
    expect(accepted[0].proof.nonce).not.toBe(rejected[0].proof.nonce)
    await service.stop()
  })

  it('cannot clear a new login operation when an old heartbeat finishes late', async () => {
    vi.useFakeTimers()
    const { service, client } = fixture(claimedState())
    service.setRuntimeReady(true)
    await vi.advanceTimersByTimeAsync(0)
    const base = await client.heartbeat.mock.results[0].value
    const lookup = await client.lookup()
    let finishOld: (value: unknown) => void = () => {}
    client.heartbeat.mockImplementation(
      async (request: { heartbeatSeq: number; leaseId: string; leaseEpoch: number }) => ({
        ...base,
        leaseId: request.leaseId,
        leaseEpoch: request.leaseEpoch,
        acceptedHeartbeatSeq: request.heartbeatSeq
      })
    )
    client.heartbeat.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishOld = resolve
        })
    )
    service.requestHeartbeat()
    service.setAuthorization(null)
    client.lookup.mockResolvedValueOnce({ ...lookup, latestLeaseEpoch: 1 })
    client.acquireLease.mockResolvedValueOnce({ ...base, leaseId: ids[1], leaseEpoch: 2 })
    service.setAuthorization(refreshedAuthorization(ids[2]))
    await vi.advanceTimersByTimeAsync(0)
    expect(service.getState()).toBe('ONLINE')
    const context = service.getCurrentLeaseContext()
    expect(context?.tuple.heartbeatLeaseId).toBe(ids[1])
    let finishNew: (value: unknown) => void = () => {}
    client.heartbeat.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishNew = resolve
        })
    )
    service.requestHeartbeat()
    expect(client.heartbeat).toHaveBeenCalledTimes(4)
    finishOld({ ...base, acceptedHeartbeatSeq: 2 })
    await vi.advanceTimersByTimeAsync(0)
    service.requestHeartbeat()
    expect(client.heartbeat).toHaveBeenCalledTimes(4)
    expect(service.getCurrentLeaseContext()).toEqual(context)
    finishNew({ ...base, leaseId: ids[1], leaseEpoch: 2, acceptedHeartbeatSeq: 2 })
    await vi.advanceTimersByTimeAsync(0)
    expect(
      client.heartbeat.mock.calls.map((call) => [call[0].leaseEpoch, call[0].heartbeatSeq])
    ).toEqual([
      [1, 1],
      [1, 2],
      [2, 1],
      [2, 2],
      [2, 3]
    ])
    expect(service.getCurrentLeaseContext()).toEqual(context)
    await service.stop()
  })

  it('expires access locally even when the account refresh publisher is delayed', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(Date.parse('2026-08-25T08:00:00.000Z'))
    const { service, client } = fixture(claimedState(), () => 0, Date.now, {
      ...authorization,
      sessionExpiresAt: Date.now() + 1_000
    })
    service.setRuntimeReady(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(service.getState()).toBe('ONLINE')
    await vi.advanceTimersByTimeAsync(999)
    expect(service.getCurrentLeaseContext()).not.toBeNull()
    await vi.advanceTimersByTimeAsync(1)
    expect(service.getState()).toBe('SIGNED_OUT')
    expect(service.getCurrentLeaseContext()).toBeNull()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(client.heartbeat).toHaveBeenCalledOnce()
    await service.stop()
  })

  it('invalidates existing connections when clock expiry is observed and never revives on rollback', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(Date.parse('2026-08-25T08:00:00.000Z'))
    const { service } = fixture(claimedState(), () => 0, Date.now, {
      ...authorization,
      sessionExpiresAt: Date.now() + 1_000
    })
    service.setRuntimeReady(true)
    await vi.advanceTimersByTimeAsync(0)
    const onCloudContextChanged = vi.fn()
    service.subscribeLeaseContext(onCloudContextChanged)
    vi.setSystemTime(Date.now() + 1_000)
    expect(service.getCurrentLeaseContext()).toBeNull()
    expect(service.getState()).toBe('SIGNED_OUT')
    expect(onCloudContextChanged).toHaveBeenLastCalledWith(null)
    vi.setSystemTime(Date.now() - 1_000)
    expect(service.getCurrentLeaseContext()).toBeNull()
    expect(service.getState()).toBe('SIGNED_OUT')
    await service.stop()
  })

  it('keeps the current lease on same-session refresh and fences despite failing observers', async () => {
    const { service, client } = fixture(claimedState())
    await startClaimed(service)
    const context = service.getCurrentLeaseContext()
    service.setAuthorization({
      ...authorization,
      sessionGeneration: authorization.sessionGeneration + 1
    })
    expect(client.acquireLease).toHaveBeenCalledOnce()
    expect(service.getCurrentLeaseContext()).toEqual(context)
    service.subscribeState((state) => {
      if (state === 'SIGNED_OUT') {
        throw new Error('observer failed')
      }
    })
    service.subscribeLeaseContext((value) => {
      if (!value) {
        throw new Error('observer failed')
      }
    })
    const closeRemote = vi.fn()
    service.subscribeLeaseContext(closeRemote)
    service.setAuthorization(null)
    expect(service.getState()).toBe('SIGNED_OUT')
    expect(closeRemote).toHaveBeenLastCalledWith(null)
    await service.stop()
  })

  it('terminates an established managed Web session on real account sign-out', async () => {
    const { service: presence } = fixture(claimedState())
    await startClaimed(presence)
    const terminateSessionConnections = vi.fn()
    const consumeConnectionTicket = vi.fn().mockResolvedValue({
      managedWebSessionId: ids[0],
      runtimeSessionId: ids[1],
      status: 'ACTIVE',
      expiresAt: Date.parse('2026-08-25T08:01:00.000Z'),
      controlVersion: 1,
      runtimeDisplayMetadata: {
        runtimeRecordId: claimedState().runtimeRecordId,
        resourceVersion: 2,
        ownershipEpoch: 1,
        cloudDisplayName: null,
        cloudDisplayNameVersion: 0,
        deviceName: 'test-runtime'
      }
    })
    const ticketClient = { consumeConnectionTicket, readWebSessionDisplayMetadata: vi.fn() }
    const web = new HiveRuntimeCloudWebLaunchService({
      apiBaseUrl: 'https://api.hivekernel.com',
      config: {
        publicOrigin: 'https://code.hivekernel.com',
        webClientPath: '/web',
        websocketPath: '/_hive/runtime-rpc'
      },
      presence,
      getServerPublicKey: () => 'server-key',
      terminateSessionConnections,
      client: ticketClient,
      now: () => Date.parse('2026-08-25T08:00:00.000Z')
    })
    const server = createServer((request, response) => {
      void web.handleHttpRequest(request, response)
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') {
      throw new Error('test_server_unavailable')
    }
    const exchange = () =>
      fetch(`http://127.0.0.1:${address.port}/_hive/web-launch/exchange`, {
        method: 'POST',
        headers: { origin: 'https://code.hivekernel.com', 'content-type': 'application/json' },
        body: JSON.stringify({
          protocolVersion: 'cloud-launch/v1',
          ticketId: ids[2],
          launchSecret: 'A'.repeat(43)
        })
      })
    try {
      const first = await exchange()
      expect(first.status).toBe(201)
      const bootstrap: unknown = await first.json()
      if (
        !bootstrap ||
        typeof bootstrap !== 'object' ||
        !('sessionToken' in bootstrap) ||
        typeof bootstrap.sessionToken !== 'string'
      ) {
        throw new Error('test_bootstrap_unavailable')
      }
      const principal = web.resolveSession(
        {
          type: 'e2ee_auth',
          v: 2,
          transcriptHashB64: 'transcript',
          principalKind: 'cloud_managed_web_session',
          managedWebSessionId: ids[0],
          runtimeSessionId: ids[1],
          sessionToken: bootstrap.sessionToken
        },
        { pathname: '/_hive/runtime-rpc', origin: 'https://code.hivekernel.com' }
      )
      expect(principal).not.toBeNull()
      if (!principal) {
        throw new Error('test_principal_unavailable')
      }
      expect(web.revalidateSession(principal)).toBe(true)
      presence.setAuthorization({
        ...authorization,
        sessionGeneration: authorization.sessionGeneration + 1
      })
      expect(web.revalidateSession(principal)).toBe(true)
      expect(terminateSessionConnections).not.toHaveBeenCalled()
      presence.setAuthorization(null)
      expect(terminateSessionConnections).toHaveBeenCalledWith(ids[0])
      expect(web.revalidateSession(principal)).toBe(false)
      expect((await exchange()).status).toBe(503)
      expect(consumeConnectionTicket).toHaveBeenCalledOnce()
    } finally {
      web.close()
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await presence.stop()
    }
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
    const { service, saveState } = fixture(claimedState(''), () => 0, undefined, null)
    service.setRuntimeReady(true)
    expect(service.getState()).toBe('SIGNED_OUT')

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
