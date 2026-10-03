import { describe, expect, it } from 'vitest'
import {
  acquireHiveAccountRelayMaterial,
  disposeHiveAccountRelayMaterial,
  parseHiveAccountRelayIntent,
  relayBase64Url
} from './hive-account-relay-material'
import { parseHiveRelayJson } from './hive-relay-json'
import { sha256 } from './sha256'

const uuid = '11111111-1111-4111-8111-111111111111'
const response = () => ({
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
  runtimePublicKeyB64: '11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo',
  e2eeFraming: 'hive-relay-e2ee/v2'
})

describe('account Relay material boundary', () => {
  it('sends only a fresh public key and secret digest to Cloud and disposes secrets', async () => {
    let body: unknown
    const material = await acquireHiveAccountRelayMaterial({
      clientKind: 'DESKTOP',
      expectedResourceVersion: 1,
      createIntent: async (request) => {
        body = request
        return response()
      }
    })
    expect(body).toMatchObject({
      protocolVersion: 2,
      clientKind: 'DESKTOP',
      ticketSecretSha256: relayBase64Url(sha256(material.inner.ticketSecret)),
      clientPublicKeyB64: relayBase64Url(material.clientKeyPair.publicKey)
    })
    expect(JSON.stringify(body)).not.toContain(relayBase64Url(material.inner.ticketSecret))
    expect(JSON.stringify(material.outer)).not.toContain('ticketSecret')
    disposeHiveAccountRelayMaterial(material)
    expect(material.inner.ticketSecret.every((byte) => byte === 0)).toBe(true)
    expect(material.clientKeyPair.secretKey.every((byte) => byte === 0)).toBe(true)
    expect(material.outer.clientAdmissionToken).toBe('')
  })
  it.each([
    { connId: 'untrusted' },
    { expiresAt: 0 },
    { cellUrl: 'http://relay.hivekernel.com' },
    { cellUrl: 'https://relay.hivekernel.com/?token=secret' },
    { runtimePublicKeyB64: 'B'.repeat(43) },
    { runtimePublicKeyB64: 'A'.repeat(43) },
    { clientAdmissionToken: 'A'.repeat(8193) }
  ])('rejects an invalid authority response without printing its contents', (override) => {
    expect(() => parseHiveAccountRelayIntent({ ...response(), ...override })).toThrow()
  })
  it('rejects duplicate keys before schema validation', () => {
    expect(() => parseHiveRelayJson('{"protocolVersion":1,"protocolVersion":2}')).toThrow(
      'Ambiguous'
    )
  })
})
