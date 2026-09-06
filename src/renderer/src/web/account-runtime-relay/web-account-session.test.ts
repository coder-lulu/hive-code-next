import { describe, expect, it, vi } from 'vitest'
import nacl from 'tweetnacl'
import { WebAccountSession, requestedWebRuntime, canConnectWebRuntime } from './web-account-session'
import {
  disposeHiveAccountRelayMaterial,
  relayBase64Url
} from '../../../../shared/hive-account-relay-material'

const uuid = '11111111-1111-4111-8111-111111111111'
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
const runtime = { runtimeRecordId: uuid, resourceVersion: 3, status: 'CLAIMED' }

describe('browser account session', () => {
  it('accepts only one UUID navigation target and requires the current Relay capabilities', () => {
    expect(requestedWebRuntime('')).toBeNull()
    expect(requestedWebRuntime(`?runtime=${uuid}`)).toBe(uuid)
    expect(() => requestedWebRuntime('?runtime=https://attacker.example')).toThrow()
    expect(() => requestedWebRuntime(`?runtime=${uuid}&runtime=${uuid}`)).toThrow()
    expect(canConnectWebRuntime(runtime)).toBe(false)
    expect(
      canConnectWebRuntime({ ...runtime, connectionCapabilities: ['web-launch-grant-v1'] })
    ).toBe(false)
    expect(
      canConnectWebRuntime({
        ...runtime,
        connectionCapabilities: ['hive-relay', 'ticket-connect-v2']
      })
    ).toBe(true)
    expect(
      canConnectWebRuntime({
        ...runtime,
        status: 'UNLINKED',
        connectionCapabilities: ['hive-relay', 'ticket-connect-v2']
      })
    ).toBe(false)
  })

  it('loads the requested owned runtime through the BFF without trusting URL metadata', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(json(runtime))
    const session = new WebAccountSession(fetchImpl, 'https://console.hivekernel.com')
    expect(await session.runtime(uuid)).toEqual(runtime)
    expect(fetchImpl.mock.calls[0]).toMatchObject([
      `https://console.hivekernel.com/bff/user/runtimes/${uuid}`,
      { credentials: 'same-origin', cache: 'no-store', redirect: 'error' }
    ])
    await expect(session.runtime('../other')).rejects.toThrow()
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    fetchImpl.mockResolvedValue(
      json({ ...runtime, runtimeRecordId: '22222222-2222-4222-8222-222222222222' })
    )
    await expect(session.runtime(uuid)).rejects.toThrow('Unexpected Runtime identity')
  })
  it('uses existing same-origin cookie and CSRF with only a secret digest sent for intent issuance', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ authenticated: true, csrfToken: 'csrf' }))
      .mockResolvedValueOnce(
        json(
          {
            protocolVersion: 2,
            intentId: uuid,
            ticketId: uuid,
            expiresAt: Date.now() + 30_000,
            cellUrl: 'https://relay.hivekernel.com',
            cellId: 'cell-01',
            cellIncarnationId: uuid,
            assignmentId: uuid,
            assignmentEpoch: 1,
            relayHostId: 'AbCdEf0123456789',
            clientAdmissionToken: `e30.e30.${'A'.repeat(86)}`,
            runtimePublicKeyB64: relayBase64Url(nacl.box.keyPair().publicKey),
            e2eeFraming: 'hive-relay-e2ee/v2'
          },
          201
        )
      )
    const session = new WebAccountSession(fetchImpl, 'https://console.hivekernel.com')
    expect(await session.restore()).toBe(true)
    const material = await session.material(runtime)
    const [url, request] = fetchImpl.mock.calls[1]!
    expect(url).toBe(`https://console.hivekernel.com/bff/user/runtimes/${uuid}/connection-intents`)
    expect(request).toMatchObject({
      credentials: 'same-origin',
      redirect: 'error',
      cache: 'no-store',
      headers: { 'X-CSRF-Token': 'csrf' }
    })
    expect(request?.headers).not.toHaveProperty('Authorization')
    expect(JSON.parse(request!.body as string)).toMatchObject({
      clientKind: 'WEB',
      expectedResourceVersion: 3
    })
    expect(request!.body).not.toContain(relayBase64Url(material.inner.ticketSecret))
    disposeHiveAccountRelayMaterial(material)
    session.close()
    await expect(session.material(runtime)).rejects.toThrow('sign-in required')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('invalidates a changed browser session and rejects unsafe origins and unbounded responses', async () => {
    expect(() => new WebAccountSession(fetch, 'http://console.hivekernel.com')).toThrow('HTTPS')
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ authenticated: true, csrfToken: 'first' }))
      .mockResolvedValueOnce(json({ authenticated: true, csrfToken: 'replacement' }))
    const session = new WebAccountSession(fetchImpl, 'https://console.hivekernel.com')
    await session.restore()
    expect(await session.restore()).toBe(false)
    await expect(session.material(runtime)).rejects.toThrow()
    const oversized = new WebAccountSession(
      async () => json('x'.repeat(1024 * 1024)),
      'https://console.hivekernel.com'
    )
    await expect(oversized.restore()).rejects.toThrow('exceeds limit')
    oversized.close()
  })
})
