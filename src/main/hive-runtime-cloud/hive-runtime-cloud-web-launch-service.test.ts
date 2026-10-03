import { generateKeyPairSync } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { RuntimeConnectionTicketConsume } from './hive-runtime-cloud-response'
import { HiveRuntimeCloudRequestError } from './hive-runtime-cloud-client'
import type { HiveRuntimeCloudIdentity } from './hive-runtime-cloud-identity-store'
import type { CurrentHiveRuntimeCloudLeaseContext } from './hive-runtime-cloud-lease-context'
import { HiveRuntimeCloudWebLaunchService } from './hive-runtime-cloud-web-launch-service'
import { HiveRuntimeCloudWebSessionControlService } from './hive-runtime-cloud-web-session-control-service'

vi.mock('electron', () => ({ net: { fetch: vi.fn() } }))

const NOW = Date.parse('2026-08-25T08:00:00.000Z')
const TICKET_ID = '123e4567-e89b-42d3-a456-426614174000'
const MANAGED_SESSION_ID = '223e4567-e89b-42d3-a456-426614174000'
const RUNTIME_SESSION_ID = '323e4567-e89b-42d3-a456-426614174000'
const SECRET = 'A'.repeat(43)
const { privateKey, publicKey } = generateKeyPairSync('ed25519')
const identity: HiveRuntimeCloudIdentity = {
  schemaVersion: 1,
  runtimeInstanceId: '423e4567-e89b-42d3-a456-426614174000',
  privateKeyPkcs8: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
  publicKey: (publicKey.export({ format: 'jwk' }) as { x: string }).x,
  createdAt: NOW
}
const context: CurrentHiveRuntimeCloudLeaseContext = {
  authorityId: 'hive-primary',
  identity,
  tuple: {
    authorityGeneration: 2,
    runtimeRecordId: '523e4567-e89b-42d3-a456-426614174000',
    runtimeInstanceId: identity.runtimeInstanceId,
    bootId: '623e4567-e89b-42d3-a456-426614174000',
    heartbeatLeaseId: '723e4567-e89b-42d3-a456-426614174000',
    leaseEpoch: 3,
    fencingEpoch: 4
  }
}

class TestPresence {
  private listeners = new Set<(value: CurrentHiveRuntimeCloudLeaseContext | null) => void>()

  constructor(private value: CurrentHiveRuntimeCloudLeaseContext | null) {}

  getCurrentLeaseContext(): CurrentHiveRuntimeCloudLeaseContext | null {
    return this.value
  }

  subscribeLeaseContext(
    listener: (value: CurrentHiveRuntimeCloudLeaseContext | null) => void
  ): () => void {
    this.listeners.add(listener)
    listener(this.value)
    return () => this.listeners.delete(listener)
  }

  set(value: CurrentHiveRuntimeCloudLeaseContext | null): void {
    this.value = value
    for (const listener of this.listeners) {
      listener(value)
    }
  }
}

describe('Hive Runtime Cloud Web Launch service', () => {
  let server: Server
  let origin: string
  let presence: TestPresence
  let consumeConnectionTicket: Mock<
    (
      request: Record<string, unknown>,
      signal?: AbortSignal
    ) => Promise<RuntimeConnectionTicketConsume>
  >
  let terminateSessionConnections: Mock<(managedWebSessionId: string) => void>
  let service: HiveRuntimeCloudWebLaunchService

  beforeEach(async () => {
    presence = new TestPresence(context)
    consumeConnectionTicket = vi.fn().mockResolvedValue({
      managedWebSessionId: MANAGED_SESSION_ID,
      runtimeSessionId: RUNTIME_SESSION_ID,
      status: 'ACTIVE',
      expiresAt: NOW + 60_000,
      controlVersion: 1
    })
    terminateSessionConnections = vi.fn()
    service = new HiveRuntimeCloudWebLaunchService({
      apiBaseUrl: 'https://api.hivekernel.com',
      config: {
        publicOrigin: 'https://code.hivekernel.com',
        webClientPath: '/web-index.html',
        websocketPath: '/_hive/runtime-rpc'
      },
      presence,
      getServerPublicKey: () => 'server-public-key',
      terminateSessionConnections,
      client: { consumeConnectionTicket },
      now: () => NOW
    })
    server = createServer((request, response) => {
      void service.handleHttpRequest(request, response).then((handled) => {
        if (!handled) {
          response.statusCode = 404
          response.end()
        }
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    origin = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`
  })

  afterEach(async () => {
    service.close()
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    )
  })

  it('consumes once and returns a memory-only same-origin WSS bootstrap', async () => {
    const response = await exchange()

    expect(response.status).toBe(201)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    const body = (await response.json()) as Record<string, unknown>
    expect(body).toMatchObject({
      protocolVersion: 'cloud-launch/v1',
      managedWebSessionId: MANAGED_SESSION_ID,
      runtimeSessionId: RUNTIME_SESSION_ID,
      websocketUrl: 'wss://code.hivekernel.com/_hive/runtime-rpc',
      serverPublicKeyB64: 'server-public-key',
      expiresAt: '2026-08-25T08:01:00.000Z'
    })
    expect(body.sessionToken).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(consumeConnectionTicket).toHaveBeenCalledWith(
      expect.objectContaining({
        protocolVersion: 'web-launch-consume/v1',
        ticketId: TICKET_ID,
        launchSecret: SECRET,
        runtimeRecordId: context.tuple.runtimeRecordId,
        proof: expect.objectContaining({
          protocolVersion: 'hive-runtime-connection-ticket-consume/v1'
        })
      })
    )

    const principal = service.resolveSession(
      {
        type: 'e2ee_auth',
        v: 2,
        transcriptHashB64: 'transcript',
        principalKind: 'cloud_managed_web_session',
        managedWebSessionId: MANAGED_SESSION_ID,
        runtimeSessionId: RUNTIME_SESSION_ID,
        sessionToken: String(body.sessionToken)
      },
      { pathname: '/_hive/runtime-rpc', origin: 'https://code.hivekernel.com' }
    )
    expect(principal).not.toBeNull()
    expect(service.revalidateSession(principal!)).toBe(true)
    expect(JSON.stringify(principal)).not.toContain(String(body.sessionToken))
  })

  it.each([
    { init: { method: 'GET' }, expected: 405 },
    { init: { method: 'POST', headers: { 'content-type': 'application/json' } }, expected: 403 },
    {
      init: {
        method: 'POST',
        headers: {
          origin: 'https://code.hivekernel.com',
          'content-type': 'application/json',
          cookie: 'session=ambient'
        },
        body: '{}'
      },
      expected: 403
    },
    {
      init: {
        method: 'POST',
        headers: {
          origin: 'https://code.hivekernel.com',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          protocolVersion: 'cloud-launch/v1',
          ticketId: TICKET_ID,
          launchSecret: SECRET,
          deviceToken: 'forbidden'
        })
      },
      expected: 400
    },
    {
      init: {
        method: 'POST',
        headers: {
          origin: 'https://code.hivekernel.com',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          protocolVersion: 'cloud-launch/v1',
          ticketId: TICKET_ID,
          launchSecret: 'B'.repeat(43)
        })
      },
      expected: 400
    }
  ])('rejects unsafe exchange input without consuming a ticket', async ({ init, expected }) => {
    const response = await fetch(`${origin}/_hive/web-launch/exchange`, init as RequestInit)

    expect(response.status).toBe(expected)
    expect(consumeConnectionTicket).not.toHaveBeenCalled()
  })

  it('does not authorize the Cloud token on a pairing path or wrong Origin', async () => {
    const response = await exchange()
    const body = (await response.json()) as { sessionToken: string }
    const auth = {
      type: 'e2ee_auth' as const,
      v: 2 as const,
      transcriptHashB64: 'transcript',
      principalKind: 'cloud_managed_web_session' as const,
      managedWebSessionId: MANAGED_SESSION_ID,
      runtimeSessionId: RUNTIME_SESSION_ID,
      sessionToken: body.sessionToken
    }

    expect(
      service.resolveSession(auth, { pathname: '/', origin: 'https://code.hivekernel.com' })
    ).toBeNull()
    expect(
      service.resolveSession(auth, {
        pathname: '/_hive/runtime-rpc',
        origin: 'https://evil.example'
      })
    ).toBeNull()
  })

  it('fences the local session and terminates sockets when presence disappears', async () => {
    await exchange()

    presence.set(null)

    expect(terminateSessionConnections).toHaveBeenCalledWith(MANAGED_SESSION_ID)
  })

  it('removes the registry entry and terminates its socket before a revocation ack', async () => {
    const bootstrap = (await (await exchange()).json()) as { sessionToken: string }
    const events: string[] = []
    terminateSessionConnections.mockImplementation(() => events.push('terminate'))
    const acknowledgeWebSessionRevocations = vi.fn().mockImplementation(async () => {
      events.push('ack')
    })
    const controls = new HiveRuntimeCloudWebSessionControlService({
      apiBaseUrl: 'https://api.hivekernel.com',
      presence,
      target: service,
      client: {
        pullWebSessionControls: vi.fn().mockResolvedValue({
          commands: [
            {
              managedWebSessionId: MANAGED_SESSION_ID,
              runtimeSessionId: RUNTIME_SESSION_ID,
              controlVersion: 2,
              action: 'REVOKE'
            }
          ]
        }),
        acknowledgeWebSessionRevocations
      }
    })

    await controls.pollNow()
    await controls.pollNow()

    expect(events).toEqual(['terminate', 'ack', 'terminate', 'ack'])
    expect(
      service.resolveSession(
        {
          type: 'e2ee_auth',
          v: 2,
          transcriptHashB64: 'transcript',
          principalKind: 'cloud_managed_web_session',
          managedWebSessionId: MANAGED_SESSION_ID,
          runtimeSessionId: RUNTIME_SESSION_ID,
          sessionToken: bootstrap.sessionToken
        },
        {
          pathname: '/_hive/runtime-rpc',
          origin: 'https://code.hivekernel.com'
        }
      )
    ).toBeNull()
    await controls.stop()
  })

  it.each([
    ['expired or replayed ticket', new HiveRuntimeCloudRequestError(410, 'ticket_unavailable')],
    [
      'already-expired managed session',
      {
        managedWebSessionId: MANAGED_SESSION_ID,
        runtimeSessionId: RUNTIME_SESSION_ID,
        status: 'ACTIVE' as const,
        expiresAt: NOW,
        controlVersion: 1
      }
    ]
  ])('does not mint a local socket credential for an %s', async (_case, result) => {
    if (result instanceof Error) {
      consumeConnectionTicket.mockRejectedValueOnce(result)
    } else {
      consumeConnectionTicket.mockResolvedValueOnce(result)
    }

    const response = await exchange()

    expect(response.status).toBe(410)
    expect(JSON.stringify(await response.json())).not.toContain(SECRET)
    expect(terminateSessionConnections).not.toHaveBeenCalled()
  })

  it('refuses a consumed result when the current Runtime tuple changes in flight', async () => {
    consumeConnectionTicket.mockImplementationOnce(async () => {
      presence.set({
        ...context,
        tuple: { ...context.tuple, fencingEpoch: context.tuple.fencingEpoch + 1 }
      })
      return {
        managedWebSessionId: MANAGED_SESSION_ID,
        runtimeSessionId: RUNTIME_SESSION_ID,
        status: 'ACTIVE',
        expiresAt: NOW + 60_000,
        controlVersion: 1
      }
    })

    const response = await exchange()

    expect(response.status).toBe(503)
    expect(terminateSessionConnections).not.toHaveBeenCalled()
  })

  async function exchange(): Promise<Response> {
    return fetch(`${origin}/_hive/web-launch/exchange`, {
      method: 'POST',
      headers: {
        origin: 'https://code.hivekernel.com',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        protocolVersion: 'cloud-launch/v1',
        ticketId: TICKET_ID,
        launchSecret: SECRET
      })
    })
  }
})
