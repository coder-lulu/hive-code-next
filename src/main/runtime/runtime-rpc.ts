import type { MobileRelayHostCatalog } from './mobile-desktop-relay/mobile-relay-host-catalog'
import type { HiveRuntimeCloudWebLaunchService } from '../hive-runtime-cloud/hive-runtime-cloud-web-launch-service'
// Why: the single security boundary for the bundled CLI — auth-token enforcement, metadata publication, transport orchestration.
import { RuntimeRpcShutdown } from './runtime-rpc/runtime-rpc-shutdown'
import type { OrcaRuntimeRpcServerOptions } from './runtime-rpc/runtime-rpc-pairing-types'

export class OrcaRuntimeRpcServer extends RuntimeRpcShutdown {
  setMobileRelayHostCatalog(catalog: MobileRelayHostCatalog | null): void {
    this.mobileRelayHostCatalog = catalog
  }

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
