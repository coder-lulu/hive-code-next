import { NETWORK_EXPOSURE_FAILED_GUIDANCE } from '../network-exposure-guidance'
import { RuntimeRpcPairing } from './runtime-rpc-pairing'
import { pairingUnavailable, type MobilePairingOffer } from './runtime-rpc-pairing-types'

export class RuntimeRpcMobilePairing extends RuntimeRpcPairing {
  async createMobilePairingOffer(args: {
    address?: string | null
    name?: string
    rotate?: boolean
  }): Promise<MobilePairingOffer> {
    try {
      await this.ensureNetworkExposure()
    } catch (error) {
      console.error(
        '[runtime] Network exposure failed while creating a mobile pairing offer:',
        error
      )
      return pairingUnavailable('network_exposure_failed', NETWORK_EXPOSURE_FAILED_GUIDANCE)
    }
    return this.createPairingOffer({ ...args, scope: 'mobile' })
  }
}
