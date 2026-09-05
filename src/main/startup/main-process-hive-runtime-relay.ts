import { join } from 'node:path'
import { HiveRuntimeRelayHostService } from '../hive-runtime-cloud/relay-host/hive-runtime-relay-host-service'
import type { HiveRuntimeCloudConfig } from '../hive-runtime-cloud/hive-runtime-cloud-config'
import type { HiveRuntimeCloudPresenceService } from '../hive-runtime-cloud/hive-runtime-cloud-presence-service'
import type { OrcaRuntimeRpcServer } from '../runtime/runtime-rpc'
import {
  hiveRelayV2HostEnabled,
  hiveRuntimeRelayRegion
} from '../hive-runtime-cloud/relay-host/hive-runtime-relay-config'
export { hiveRelayV2HostEnabled } from '../hive-runtime-cloud/relay-host/hive-runtime-relay-config'

let host: HiveRuntimeRelayHostService | null = null

export function installHiveRuntimeRelay(
  config: HiveRuntimeCloudConfig,
  presence: HiveRuntimeCloudPresenceService,
  runtimeRpc: OrcaRuntimeRpcServer,
  userDataPath: string,
  env: NodeJS.ProcessEnv = process.env
): void {
  if (host || !config.enabled || !hiveRelayV2HostEnabled(env)) {
    return
  }
  const requestedRegion = hiveRuntimeRelayRegion(env)
  host = new HiveRuntimeRelayHostService({
    apiBaseUrl: config.apiBaseUrl,
    storageDirectory: join(userDataPath, 'hive-runtime-relay'),
    requestedRegion,
    presence,
    getKeypair: () => runtimeRpc.getE2EEKeypair(),
    attachRpc: (connection) => runtimeRpc.attachAccountRuntimeConnection(connection)
  })
  host.start()
}

export function stopHiveRuntimeRelay(): Promise<void> {
  const stopping = host
  host = null
  return stopping?.stop() ?? Promise.resolve()
}
