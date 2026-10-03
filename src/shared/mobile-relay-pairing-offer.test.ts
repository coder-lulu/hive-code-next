import { describe, expect, it } from 'vitest'
import { PairingOfferSchema } from './mobile-relay-pairing-offer'
import { decodePairingOffer, encodePairingOffer } from './pairing'

const offer = {
  v: 2 as const,
  endpoint: 'ws://192.168.1.2:6768',
  deviceToken: 'device-token',
  publicKeyB64: 'public-key'
}
describe('local pairing contract', () => {
  it('round-trips the current local QR with optional authenticated identity', () => {
    const current = {
      ...offer,
      pairedDeviceId: 'device-a',
      runtimeRecordId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    }
    expect(decodePairingOffer(encodePairingOffer(current))).toEqual(current)
  })
  it.each([
    { ...offer, v: 1 },
    { ...offer, relay: { inviteToken: 'obsolete' } }
  ])('rejects obsolete versions and Relay extensions', (input) => {
    expect(PairingOfferSchema.safeParse(input).success).toBe(false)
    expect(() => encodePairingOffer(input as typeof offer)).toThrow()
  })
})
