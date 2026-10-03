import { normalizeLookup } from './hive-runtime-cloud-response'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ net: { fetch: vi.fn() } }))

import {
  HiveRuntimeCloudClient,
  HiveRuntimeCloudRequestError,
  HiveRuntimeCloudTransportError
} from './hive-runtime-cloud-client'

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

describe('Hive Runtime Cloud HTTP client', () => {
  it('sends signed lookup with redirect and cache disabled and parses only the frozen shape', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        exists: true,
        runtimeRecordId: '123e4567-e89b-42d3-a456-426614174000',
        status: 'CLAIMED',
        resourceVersion: 2,
        authorityGeneration: 3,
        fencingEpoch: 4,
        latestLeaseEpoch: 5,
        identityPublicKeySha256: 'a'.repeat(64)
      })
    )
    const client = new HiveRuntimeCloudClient('https://api.hivekernel.com', fetchImpl)

    await expect(client.lookup({ proof: 'redacted' })).resolves.toMatchObject({
      exists: true,
      latestLeaseEpoch: 5
    })
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.hivekernel.com/hive/v1/runtime-registrations/lookup',
      expect.objectContaining({ method: 'POST', cache: 'no-store', redirect: 'error' })
    )
  })

  it('returns only the stable Problem category on Claim authorization failure', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ code: 'runtime_claim_step_up_required' }, 403))
    const client = new HiveRuntimeCloudClient('https://api.hivekernel.com', fetchImpl)

    const failure = await client
      .claim({}, 'secret-access', 'idempotency-key-1234')
      .catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(HiveRuntimeCloudRequestError)
    expect(failure).toMatchObject({ status: 403, category: 'runtime_claim_step_up_required' })
    expect(String(failure)).not.toContain('secret-access')
  })

  it.each([
    ['empty', () => new Response(null, { status: 401 })],
    ['HTML', () => new Response('<html>unauthorized</html>', { status: 401 })],
    [
      'oversized',
      () =>
        new Response('{}', {
          status: 401,
          headers: { 'content-length': '65537' }
        })
    ]
  ])('preserves a 401 status for %s error bodies', async (_bodyKind, responseFactory) => {
    for (const method of ['POST', 'GET'] as const) {
      const client = new HiveRuntimeCloudClient(
        'https://api.hivekernel.com',
        vi.fn().mockResolvedValue(responseFactory())
      )
      const failure = await (
        method === 'POST'
          ? client.claim({}, 'secret-access', 'idempotency-key-1234')
          : client.listOwnedRuntimes('secret-access', null, 50)
      ).catch((error: unknown) => error)

      expect(failure).toBeInstanceOf(HiveRuntimeCloudRequestError)
      expect(failure).toMatchObject({ status: 401, category: null })
      expect(String(failure)).not.toContain('secret-access')
    }
  })

  it('rejects unknown response fields', async () => {
    const client = new HiveRuntimeCloudClient(
      'https://api.hivekernel.com',
      vi.fn().mockResolvedValue(jsonResponse({ exists: false, ownerAccountId: 'leak' }))
    )

    await expect(client.lookup({})).rejects.toThrow('invalid_hive_runtime_cloud_response')
  })

  it('fails before parsing a response that declares more than 64 KiB', async () => {
    const response = new Response('{}', {
      status: 200,
      headers: { 'content-length': '65537' }
    })
    const client = new HiveRuntimeCloudClient(
      'https://api.hivekernel.com',
      vi.fn().mockResolvedValue(response)
    )

    await expect(client.lookup({})).rejects.toThrow('hive_runtime_cloud_response_too_large')
  })

  it('propagates a pre-aborted signal as a redacted transport failure', async () => {
    const fetchImpl = vi.fn((_url: string, init: RequestInit) => {
      expect(init.signal).toMatchObject({ aborted: true })
      return Promise.reject(new Error('sensitive upstream detail'))
    })
    const controller = new AbortController()
    controller.abort()
    const client = new HiveRuntimeCloudClient('https://api.hivekernel.com', fetchImpl)

    const failure = await client.lookup({}, controller.signal).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(HiveRuntimeCloudTransportError)
    expect(String(failure)).not.toContain('sensitive upstream detail')
  })

  it('loads the owner directory with Bearer auth and keeps pairing secrets out of the shape', async () => {
    const response = jsonResponse({
      futureOptionalPageField: { revision: 2 },
      items: [
        {
          runtimeRecordId: '123e4567-e89b-42d3-a456-426614174000',
          status: 'CLAIMED',
          runtimeVersion: '1.5.0',
          runtimeProtocolVersion: 3,
          capabilities: ['pairing-v3'],
          resourceVersion: 2,
          createdAt: '2026-08-31T00:00:00.000Z',
          updatedAt: '2026-08-31T00:01:00.000Z',
          claimedAt: '2026-08-31T00:00:30.000Z',
          presence: 'ONLINE',
          lastHeartbeatAt: '2026-08-31T00:01:00.000Z',
          clientAuthMode: 'IDENTITY_PROOF',
          credentialState: 'ACTIVE',
          deviceName: 'build-host',
          osName: 'Linux',
          osVersion: '#1 SMP',
          osArch: 'arm64',
          cpuModel: 'Example CPU',
          cpuLogicalCores: 8,
          totalMemoryBytes: 34359738368,
          lastSeenIp: '203.0.113.24',
          cloudDisplayName: 'Build Runtime',
          cloudDisplayNameVersion: 4,
          futureOptionalDirectoryField: { enabled: true },
          projection: {
            runtimeVersion: '1.5.0',
            runtimeProtocolVersion: 3,
            capabilities: ['pairing-v3'],
            readiness: 'READY',
            readinessReasonCode: 'healthy',
            startedAt: '2026-08-31T00:00:00.000Z',
            sourceReportedAt: '2026-08-31T00:00:59.000Z',
            observedAt: '2026-08-31T00:01:00.000Z',
            freeDiskBytes: 1024,
            lastBackupAt: '2026-08-31T00:00:30.000Z',
            connectionCapabilities: ['hive-relay'],
            futureOptionalProjectionField: 'forward-compatible'
          }
        }
      ]
    })
    response.headers.set('x-hive-next-cursor', 'cursor-next')
    const fetchImpl = vi.fn().mockResolvedValue(response)
    const client = new HiveRuntimeCloudClient('https://api.hivekernel.com', fetchImpl)

    await expect(client.listOwnedRuntimes('account-secret', null, 50)).resolves.toMatchObject({
      items: [
        {
          runtimeRecordId: '123e4567-e89b-42d3-a456-426614174000',
          presence: 'ONLINE',
          clientAuthMode: 'IDENTITY_PROOF',
          credentialState: 'ACTIVE',
          readiness: 'READY',
          freeDiskBytes: 1024,
          connectionCapabilities: ['hive-relay'],
          cloudDisplayName: 'Build Runtime',
          cloudDisplayNameVersion: 4,
          deviceName: 'build-host',
          osName: 'Linux',
          cpuLogicalCores: 8,
          totalMemoryBytes: 34359738368,
          lastSeenIp: '203.0.113.24'
        }
      ],
      nextCursor: 'cursor-next'
    })
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.hivekernel.com/hive/v1/runtimes?limit=50',
      expect.objectContaining({
        method: 'GET',
        cache: 'no-store',
        redirect: 'error',
        headers: expect.objectContaining({ authorization: 'Bearer account-secret' })
      })
    )
  })

  it('updates a Runtime alias with PATCH and no idempotency header', async () => {
    const runtimeRecordId = '123e4567-e89b-42d3-a456-426614174000'
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        runtimeRecordId,
        cloudDisplayName: 'Build Runtime',
        cloudDisplayNameVersion: 5,
        updatedAt: '2026-09-01T00:00:00.000Z'
      })
    )
    const client = new HiveRuntimeCloudClient('https://api.hivekernel.com', fetchImpl)

    await expect(
      client.updateOwnedRuntimeDisplayName(runtimeRecordId, ' Build Runtime ', 4, 'secret-token')
    ).resolves.toMatchObject({ cloudDisplayName: 'Build Runtime', cloudDisplayNameVersion: 5 })
    expect(fetchImpl).toHaveBeenCalledWith(
      `https://api.hivekernel.com/hive/v1/runtimes/${runtimeRecordId}`,
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          cloudDisplayName: 'Build Runtime',
          expectedCloudDisplayNameVersion: 4
        }),
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          authorization: 'Bearer secret-token'
        }
      })
    )
    expect(fetchImpl.mock.calls[0]?.[1]?.headers).not.toHaveProperty('idempotency-key')
  })

  it('rejects a non-empty directory alias without its concurrency version', async () => {
    const client = new HiveRuntimeCloudClient(
      'https://api.hivekernel.com',
      vi.fn().mockResolvedValue(
        jsonResponse({
          items: [
            {
              runtimeRecordId: '123e4567-e89b-42d3-a456-426614174000',
              status: 'CLAIMED',
              runtimeVersion: '1.5.0',
              runtimeProtocolVersion: 3,
              capabilities: [],
              resourceVersion: 2,
              createdAt: '2026-08-31T00:00:00.000Z',
              updatedAt: '2026-08-31T00:01:00.000Z',
              presence: 'OFFLINE',
              cloudDisplayName: 'Alias'
            }
          ]
        })
      )
    )

    await expect(client.listOwnedRuntimes('token', null, 50)).rejects.toThrow(
      'invalid_hive_runtime_cloud_directory_response'
    )
  })

  it('accepts a cleared directory alias represented by a version without a value', async () => {
    const client = new HiveRuntimeCloudClient(
      'https://api.hivekernel.com',
      vi.fn().mockResolvedValue(
        jsonResponse({
          items: [
            {
              runtimeRecordId: '123e4567-e89b-42d3-a456-426614174000',
              status: 'CLAIMED',
              runtimeVersion: '1.5.0',
              runtimeProtocolVersion: 3,
              capabilities: [],
              resourceVersion: 2,
              createdAt: '2026-08-31T00:00:00.000Z',
              updatedAt: '2026-08-31T00:01:00.000Z',
              presence: 'OFFLINE',
              cloudDisplayNameVersion: 3
            }
          ]
        })
      )
    )

    await expect(client.listOwnedRuntimes('token', null, 50)).resolves.toMatchObject({
      items: [{ cloudDisplayName: null, cloudDisplayNameVersion: 3 }]
    })
  })

  it('lists and revokes unified Runtime sessions with the frozen control contract', async () => {
    const session = {
      managedSessionId: '11111111-1111-4111-8111-111111111111',
      runtimeRecordId: '22222222-2222-4222-8222-222222222222',
      runtimeInstanceId: '33333333-3333-4333-8333-333333333333',
      runtimeSessionId: '44444444-4444-4444-8444-444444444444',
      backendAuthorityId: 'hive-primary',
      clientKind: 'WEB',
      clientLabel: null,
      status: 'ACTIVE',
      resourceVersion: 2,
      controlVersion: 3,
      createdAt: '2026-08-31T00:00:00.000Z',
      expiresAt: '2026-08-31T01:00:00.000Z',
      revokeRequestedAt: null,
      revokeAcknowledgedAt: null
    }
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ items: [session], nextCursor: null }))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            protocolVersion: 'account-runtime-session-revoke/v2',
            operationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            managedSessionId: session.managedSessionId,
            status: 'REVOKE_PENDING',
            resourceVersion: 3,
            controlVersion: 4
          },
          202
        )
      )
    const client = new HiveRuntimeCloudClient('https://api.hivekernel.com', fetchImpl)

    await expect(client.listRuntimeSessions('account-secret', null, 100)).resolves.toMatchObject({
      items: [{ managedSessionId: session.managedSessionId, clientKind: 'WEB' }],
      nextCursor: null
    })
    await expect(
      client.revokeRuntimeSession(
        session.managedSessionId,
        3,
        'account-secret',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      )
    ).resolves.toMatchObject({ status: 'REVOKE_PENDING' })
    expect(fetchImpl.mock.calls[1]?.[1]).toMatchObject({
      method: 'POST',
      headers: expect.objectContaining({
        authorization: 'Bearer account-secret'
      }),
      body: JSON.stringify({
        protocolVersion: 'account-runtime-session-revoke/v2',
        operationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        expectedResourceVersion: 3
      })
    })
  })

  it('pins the public authority document without sending account credentials', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        contractRevision: 'c0-rc',
        protocolVersion: 1,
        authorityId: 'hive-primary',
        capabilities: ['hive.device.authorization'],
        clientIntegrationReady: true
      })
    )
    const client = new HiveRuntimeCloudClient('https://api.hivekernel.com', fetchImpl)

    await expect(client.getAuthorityId()).resolves.toBe('hive-primary')
    await expect(client.getAuthorityId()).resolves.toBe('hive-primary')
    expect(fetchImpl).toHaveBeenCalledOnce()
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.hivekernel.com/hive/v1/meta/capabilities',
      expect.objectContaining({
        method: 'GET',
        headers: { accept: 'application/json' }
      })
    )
  })

  it('uses the frozen Runtime-only claim recovery and device-code routes', async () => {
    const runtimeRecordId = '123e4567-e89b-42d3-a456-426614174000'
    const runtimeInstanceId = '223e4567-e89b-42d3-a456-426614174000'
    const challengeId = '323e4567-e89b-42d3-a456-426614174000'
    const deviceCode = Buffer.alloc(32, 1).toString('base64url')
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          runtimeRecordId,
          claimCapability: Buffer.alloc(32, 2).toString('base64url'),
          claimExpiresAt: '2026-08-31T00:10:00.000Z',
          resourceVersion: 2
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          runtimeRecordId,
          runtimeInstanceId,
          status: 'CLAIMED',
          authorityGeneration: 1,
          fencingEpoch: 1,
          latestLeaseEpoch: 0,
          resourceVersion: 3,
          clientAuthMode: 'IDENTITY_PROOF'
        })
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            challengeId,
            userCode: 'ABCD-EFGH',
            deviceCode,
            verificationUri: 'https://code.hivekernel.com/runtime/claim',
            expiresAt: '2026-08-31T00:10:00.000Z',
            pollIntervalSeconds: 5
          },
          201
        )
      )
      .mockResolvedValueOnce(
        jsonResponse({ status: 'PENDING', nextPollAt: '2026-08-31T00:00:05.000Z' })
      )
    const client = new HiveRuntimeCloudClient('https://api.hivekernel.com', fetchImpl)

    await expect(client.reissueClaimCapability(runtimeRecordId, {})).resolves.toMatchObject({
      runtimeRecordId,
      resourceVersion: 2
    })
    await expect(
      client.reconcileClaim(runtimeRecordId, {}, 'account-secret')
    ).resolves.toMatchObject({ status: 'CLAIMED', runtimeInstanceId })
    await expect(client.createClaimChallenge({})).resolves.toMatchObject({
      challengeId,
      userCode: 'ABCD-EFGH'
    })
    await expect(client.pollClaimChallenge(challengeId, deviceCode)).resolves.toMatchObject({
      status: 'PENDING'
    })

    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      `https://api.hivekernel.com/hive/v1/runtime-records/${runtimeRecordId}/reclaim-capabilities`,
      `https://api.hivekernel.com/hive/v1/runtime-records/${runtimeRecordId}/claim-reconcile`,
      'https://api.hivekernel.com/hive/v1/runtime-claim-challenges',
      `https://api.hivekernel.com/hive/v1/runtime-claim-challenges/${challengeId}/poll`
    ])
    expect(fetchImpl.mock.calls[1]?.[1]).toMatchObject({
      headers: expect.objectContaining({ authorization: 'Bearer account-secret' })
    })
  })

  it('consumes a Connection Ticket using the Cloud controller 200 response contract', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        managedWebSessionId: '123e4567-e89b-42d3-a456-426614174000',
        runtimeSessionId: '223e4567-e89b-42d3-a456-426614174000',
        status: 'ACTIVE',
        expiresAt: '2026-08-25T09:00:00.000Z',
        controlVersion: 1
      })
    )
    const client = new HiveRuntimeCloudClient('https://api.hivekernel.com', fetchImpl)
    const request = { protocolVersion: 'web-launch-consume/v1', proof: 'signed' }

    await expect(client.consumeConnectionTicket(request)).resolves.toMatchObject({
      status: 'ACTIVE',
      controlVersion: 1
    })
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.hivekernel.com/hive/v1/connection-tickets',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(request),
        cache: 'no-store',
        redirect: 'error'
      })
    )
  })

  it('pulls strict revocation commands and accepts only an empty 204 acknowledgement', async () => {
    const command = {
      managedWebSessionId: '123e4567-e89b-42d3-a456-426614174000',
      runtimeSessionId: '223e4567-e89b-42d3-a456-426614174000',
      controlVersion: 2,
      action: 'REVOKE'
    }
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ commands: [command] }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    const client = new HiveRuntimeCloudClient('https://api.hivekernel.com', fetchImpl)

    await expect(client.pullWebSessionControls({ proof: 'pull' })).resolves.toEqual({
      commands: [command]
    })
    await expect(client.acknowledgeWebSessionRevocations({ proof: 'ack' })).resolves.toBeUndefined()
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      'https://api.hivekernel.com/hive/v1/runtime-web-sessions/control-pull',
      'https://api.hivekernel.com/hive/v1/runtime-web-sessions/revocation-acks'
    ])
  })

  it('rejects a 204 acknowledgement that declares a response body', async () => {
    const response = new Response(null, {
      status: 204,
      headers: { 'content-length': '2' }
    })
    const client = new HiveRuntimeCloudClient(
      'https://api.hivekernel.com',
      vi.fn().mockResolvedValue(response)
    )

    await expect(client.acknowledgeWebSessionRevocations({})).rejects.toThrow(
      'invalid_hive_runtime_cloud_response'
    )
  })
})

describe('unlinked Runtime lookup', () => {
  it('accepts the authoritative terminal ownership state without accepting unknown states', () => {
    const value = {
      exists: true,
      runtimeRecordId: '723e4567-e89b-42d3-a456-426614174000',
      status: 'UNLINKED',
      resourceVersion: 3,
      authorityGeneration: 1,
      fencingEpoch: 2,
      latestLeaseEpoch: 1,
      identityPublicKeySha256: 'a'.repeat(64)
    }
    expect(normalizeLookup(value)).toEqual(value)
    expect(() => normalizeLookup({ ...value, status: 'UNKNOWN' })).toThrow()
  })
})
