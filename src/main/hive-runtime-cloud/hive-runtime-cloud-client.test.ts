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
