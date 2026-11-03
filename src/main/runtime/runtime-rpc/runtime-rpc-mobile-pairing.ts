import type { MobilePairingConnectionMode } from '../../../shared/mobile-pairing-connection-mode'
import { NETWORK_EXPOSURE_FAILED_GUIDANCE } from '../network-exposure-guidance'
import { RuntimeRpcPairing } from './runtime-rpc-pairing'
import { pairingUnavailable, type MobilePairingOffer } from './runtime-rpc-pairing-types'

export class RuntimeRpcMobilePairing extends RuntimeRpcPairing {
  async createMobilePairingOffer(args: {
    address?: string | null
    name?: string
    rotate?: boolean
    connectionMode?: MobilePairingConnectionMode
  }): Promise<MobilePairingOffer> {
    if (args.connectionMode === 'automatic') {
      return pairingUnavailable(
        'websocket_unavailable',
        'Relay mobile pairing is unavailable. Use local network pairing or the configured Hive account connection.'
      )
    }
    try {
      await this.ensureNetworkExposure()
    } catch (error) {
      console.error(
        '[runtime] Network exposure failed while creating a mobile pairing offer:',
        error
      )
      return pairingUnavailable('network_exposure_failed', NETWORK_EXPOSURE_FAILED_GUIDANCE)
    }
    const offer = this.createPairingOffer({ ...args, scope: 'mobile' })
    return offer.available ? { ...offer, connectionMode: 'local-only' } : offer
  }
}
