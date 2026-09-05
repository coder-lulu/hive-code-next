import type { HiveRuntimeCloudWebLaunchService } from '../hive-runtime-cloud/hive-runtime-cloud-web-launch-service'
// Why: the single security boundary for the bundled CLI — auth-token enforcement, metadata publication, transport orchestration.
import { RuntimeRpcShutdown } from './runtime-rpc/runtime-rpc-shutdown'
import type { OrcaRuntimeRpcServerOptions } from './runtime-rpc/runtime-rpc-pairing-types'

export type {
  PairingOfferUnavailableReason,
  PairingOfferUnavailable
} from './runtime-rpc/runtime-rpc-pairing-types'
export type { MobilePairingConnectionContext } from './runtime-rpc/runtime-rpc-pairing-types'
export type { RuntimeLongPollClass } from './runtime-rpc/runtime-rpc-long-poll'
export { classifyRuntimeLongPoll } from './runtime-rpc/runtime-rpc-long-poll'

export class OrcaRuntimeRpcServer extends RuntimeRpcShutdown {
  setCloudWebLaunchService(service: HiveRuntimeCloudWebLaunchService | null): void {
    this.cloudWebLaunchService = service
  }

  terminateCloudWebSessionConnections(managedWebSessionId: string): number {
    return this.mobileSocketWiring?.terminateCloudSessionConnections(managedWebSessionId) ?? 0
  }

  constructor(options: OrcaRuntimeRpcServerOptions) {
    super(options)
  }
}

export {
  RUNTIME_SOCKET_NAME_REGEX,
  sweepOrphanedRuntimeSockets,
  createRuntimeTransportMetadata
} from './runtime-rpc/runtime-rpc-socket-metadata'
