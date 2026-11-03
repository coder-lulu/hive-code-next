import { describe, expect, it, vi } from 'vitest'
import { RuntimeRpcMobilePairing } from './runtime-rpc-mobile-pairing'

describe('current mobile pairing transport authority', () => {
  it('refuses relay intent before opening a listener or minting a local credential', async () => {
    const context = { ensureNetworkExposure: vi.fn(), createPairingOffer: vi.fn() }
    const result = await RuntimeRpcMobilePairing.prototype.createMobilePairingOffer.call(
      context as never,
      { connectionMode: 'automatic' }
    )
    expect(result).toMatchObject({ available: false, reason: 'websocket_unavailable' })
    expect(context.ensureNetworkExposure).not.toHaveBeenCalled()
    expect(context.createPairingOffer).not.toHaveBeenCalled()
  })
  it('labels direct offers as local-only and preserves rotation', async () => {
    const offer = {
      available: true,
      pairingUrl: `${PRIMARY_PAIRING_SCHEME}://pair`,
      endpoint: 'ws://192.168.1.2:6768',
      deviceId: 'phone',
      webClientUrl: null
    }
    const context = {
      ensureNetworkExposure: vi.fn().mockResolvedValue(undefined),
      createPairingOffer: vi.fn().mockReturnValue(offer)
    }
    const result = await RuntimeRpcMobilePairing.prototype.createMobilePairingOffer.call(
      context as never,
      { address: '192.168.1.2', rotate: true, connectionMode: 'local-only' }
    )
    expect(result).toEqual({ ...offer, connectionMode: 'local-only' })
    expect(context.createPairingOffer).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'mobile', rotate: true })
    )
  })
  it('does not mint credentials when network exposure fails', async () => {
    const context = {
      ensureNetworkExposure: vi.fn().mockRejectedValue(new Error('bind failed')),
      createPairingOffer: vi.fn()
    }
    const result = await RuntimeRpcMobilePairing.prototype.createMobilePairingOffer.call(
      context as never,
      {}
    )
    expect(result).toMatchObject({ available: false, reason: 'network_exposure_failed' })
    expect(context.createPairingOffer).not.toHaveBeenCalled()
  })
})

import { PRIMARY_PAIRING_SCHEME } from '../../../shared/pairing'
