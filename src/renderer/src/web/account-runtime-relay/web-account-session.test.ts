import { describe, expect, it, vi } from 'vitest'
import nacl from 'tweetnacl'
import { WebAccountSession } from './web-account-session'
import {
  disposeHiveAccountRelayMaterial,
  relayBase64Url
} from '../../../../shared/hive-account-relay-material'

const uuid = '11111111-1111-4111-8111-111111111111'
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
const runtime = { runtimeRecordId: uuid, resourceVersion: 3, status: 'CLAIMED' }

describe('browser account session', () => {
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
