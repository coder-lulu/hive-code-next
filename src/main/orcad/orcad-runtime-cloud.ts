import { join } from 'node:path'
import { getHiveRuntimeCloudConfig } from '../hive-runtime-cloud/hive-runtime-cloud-config'
import { HiveRuntimeCloudClient } from '../hive-runtime-cloud/hive-runtime-cloud-client'
import { HiveRuntimeCloudPresenceService } from '../hive-runtime-cloud/hive-runtime-cloud-presence-service'
import { defaultPresenceDependencies } from '../hive-runtime-cloud/hive-runtime-cloud-presence-support'
import { createHiveRuntimeCloudReport } from '../hive-runtime-cloud/hive-runtime-cloud-report'
import {
  collectHiveRuntimeFreeDiskBytes,
  getHiveRuntimeDeviceInfoSnapshot
} from '../hive-runtime-cloud/hive-runtime-device-info'
import {
  clearHiveRuntimeCloudServiceIdentity,
  getOrCreateHiveRuntimeCloudServiceIdentity
} from '../hive-runtime-cloud/hive-runtime-cloud-identity-store'
import {
  clearHiveRuntimeCloudServiceRegistrationState,
  readHiveRuntimeCloudServiceRegistrationState,
  saveHiveRuntimeCloudServiceRegistrationState
} from '../hive-runtime-cloud/hive-runtime-cloud-state-store'
import {
  defaultLocalRuntimeOwnershipDependencies,
  LocalRuntimeOwnershipService
} from '../hive-runtime-cloud/local-runtime-ownership-service'
import { HiveRuntimeRelayHostService } from '../hive-runtime-cloud/relay-host/hive-runtime-relay-host-service'
import { hiveRuntimeRelayRegion } from '../hive-runtime-cloud/relay-host/hive-runtime-relay-config'
import type { OrcaRuntimeRpcServer } from '../runtime/runtime-rpc'

/** Plain Node uses the same claimed identity, signed Presence, local claim protocol and Host. */
export function createOrcadRuntimeCloud(options: {
  userDataPath: string
  runtimeVersion: string
  runtime: Parameters<typeof createHiveRuntimeCloudReport>[0]
  env?: NodeJS.ProcessEnv
}) {
  const env = options.env ?? process.env
  const config = getHiveRuntimeCloudConfig(env)
  const region = config.enabled ? hiveRuntimeRelayRegion(env) : undefined
  const getReport = () =>
    createHiveRuntimeCloudReport(options.runtime, options.runtimeVersion, undefined, Date.now, {
      ...getHiveRuntimeDeviceInfoSnapshot(),
      freeDiskBytes: collectHiveRuntimeFreeDiskBytes(options.userDataPath)
    })
  const storage = {
    loadIdentity: getOrCreateHiveRuntimeCloudServiceIdentity,
    readState: readHiveRuntimeCloudServiceRegistrationState,
    saveState: saveHiveRuntimeCloudServiceRegistrationState,
    clearIdentity: clearHiveRuntimeCloudServiceIdentity,
    clearState: clearHiveRuntimeCloudServiceRegistrationState
  }
  const createClient = (apiBaseUrl: string) => new HiveRuntimeCloudClient(apiBaseUrl)
  const presence = new HiveRuntimeCloudPresenceService(
    config,
    options.userDataPath,
    { getReport },
    {
      ...defaultPresenceDependencies,
      ...storage,
      createClient
    }
  )
  let host: HiveRuntimeRelayHostService | null = null
  const ownership = new LocalRuntimeOwnershipService({
    config,
    userDataPath: options.userDataPath,
    getReport,
    getBootId: () => presence.getBootId(),
    getRelayStatus: () => host?.getStatus() ?? 'offline',
    onRegistrationChanged: () => presence.notifyRegistrationChanged(),
    dependencies: { ...defaultLocalRuntimeOwnershipDependencies, ...storage, createClient }
  })
  const unsubscribe = presence.subscribeState((state) => ownership.setPresenceState(state))
  let ready = false
  let shutdown: Promise<void> | null = null
  return {
    ownership,
    rpcReady(rpc: OrcaRuntimeRpcServer): void {
      if (ready || shutdown) {
        return
      }
      ready = true
      if (config.enabled) {
        host = new HiveRuntimeRelayHostService({
          apiBaseUrl: config.apiBaseUrl,
          storageDirectory: join(options.userDataPath, 'hive-runtime-relay'),
          requestedRegion: region,
          presence,
          getKeypair: () => rpc.getE2EEKeypair(),
          attachRpc: (connection) => rpc.attachAccountRuntimeConnection(connection)
        })
        host.start()
      }
      presence.setRuntimeReady(true)
    },
    stop(): Promise<void> {
      if (shutdown) {
        return shutdown
      }
      presence.setRuntimeReady(false)
      unsubscribe()
      ownership.stop()
      shutdown = Promise.all([host?.stop() ?? Promise.resolve(), presence.stop()]).then(() => {})
      return shutdown
    }
  }
}
