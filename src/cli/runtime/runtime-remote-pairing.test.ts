import { describe, expect, it } from 'vitest'
import { encodePairingOffer, PAIRING_OFFER_VERSION, type PairingOffer } from '../../shared/pairing'
import { resolveRemoteConnection } from './runtime-remote-pairing'

describe('CLI current remote identity', () => {
  it('preserves the current Hive runtime identity and credential without a second auth shape', () => {
    const offer: PairingOffer = {
      v: PAIRING_OFFER_VERSION,
      endpoint: 'wss://api.hivekernel.com/runtime',
      deviceToken: 'test-device-token',
      publicKeyB64: Buffer.alloc(32, 1).toString('base64'),
      runtimeRecordId: '3af63bda-8f2e-4bbb-b4d2-ef7346b3232a',
      scope: 'runtime' as const
    }
    expect(resolveRemoteConnection('unused', encodePairingOffer(offer), null)).toEqual(offer)
  })

  it('refuses ambiguous and invalid remote selectors before opening a connection', () => {
    expect(() => resolveRemoteConnection('unused', 'invalid', 'environment')).toThrow(
      'Use either --pairing-code or --environment'
    )
    expect(() => resolveRemoteConnection('unused', 'invalid', null)).toThrow('Invalid remote pairing')
    expect(resolveRemoteConnection('unused', null, null)).toBeNull()
  })
})
