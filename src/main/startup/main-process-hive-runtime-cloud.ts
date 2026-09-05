import { app } from 'electron'
import { HiveAccountService } from '../hive-account/hive-account-service'
import { getHiveRuntimeCloudConfig } from '../hive-runtime-cloud/hive-runtime-cloud-config'
import { HiveRuntimeCloudPresenceService } from '../hive-runtime-cloud/hive-runtime-cloud-presence-service'
import { defaultPresenceDependencies } from '../hive-runtime-cloud/hive-runtime-cloud-presence-support'
import { createHiveRuntimeCloudReport } from '../hive-runtime-cloud/hive-runtime-cloud-report'
import {
  collectHiveRuntimeFreeDiskBytes,
  getHiveRuntimeDeviceInfoSnapshot
} from '../hive-runtime-cloud/hive-runtime-device-info'
import { HiveRuntimeCloudWebLaunchService } from '../hive-runtime-cloud/hive-runtime-cloud-web-launch-service'
import { HiveRuntimeCloudWebSessionControlService } from '../hive-runtime-cloud/hive-runtime-cloud-web-session-control-service'
import { HiveAccountRuntimeDirectoryService } from '../hive-runtime-cloud/hive-account-runtime-directory-service'
import { HiveAccountRuntimeSessionService } from '../hive-runtime-cloud/hive-account-runtime-session-service'
import { HiveAccountRuntimeTransport } from '../hive-runtime-cloud/hive-account-runtime-transport'
import { installHiveAccountRuntimeAccess } from '../hive-runtime-cloud/hive-account-runtime-access'
import {
  defaultLocalRuntimeOwnershipDependencies,
  LocalRuntimeOwnershipService
} from '../hive-runtime-cloud/local-runtime-ownership-service'
import {
  clearHiveRuntimeCloudServiceIdentity,
  getOrCreateHiveRuntimeCloudServiceIdentity
} from '../hive-runtime-cloud/hive-runtime-cloud-identity-store'
import {
  clearHiveRuntimeCloudServiceRegistrationState,
  readHiveRuntimeCloudServiceRegistrationState,
  saveHiveRuntimeCloudServiceRegistrationState
} from '../hive-runtime-cloud/hive-runtime-cloud-state-store'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import type { OrcaRuntimeRpcServer } from '../runtime/runtime-rpc'
import { mainProcessState as state } from './main-process-state'
import {
  getHiveRuntimeRelayStatus,
  installHiveRuntimeRelay,
  stopHiveRuntimeRelay
} from './main-process-hive-runtime-relay'

export function initializeHiveAccount(): void {
  const account = new HiveAccountService(app.getPath('userData'))
  state.hiveAccountService = account
  // Keep the shared account generation behind persisted proxy readiness without delaying first paint.
  state.hiveAccountStartupState = state.initialProxyApplicationReady
    .then(() =>
      state.isQuitting ? account.getState() : account.refresh().then((result) => result.state)
    )
    .catch(() => account.getState())
}

export function initializeHiveRuntimeCloud(runtimeService: OrcaRuntimeService): void {
  const runtimeCloudConfig = getHiveRuntimeCloudConfig()
  const getRuntimeCloudReport = () => {
    const freeDiskBytes = collectHiveRuntimeFreeDiskBytes(app.getPath('userData'))
    return createHiveRuntimeCloudReport(
      runtimeService,
      app.getVersion(),
      runtimeCloudConfig.enabled ? runtimeCloudConfig.webLaunch : undefined,
      Date.now,
      {
        ...getHiveRuntimeDeviceInfoSnapshot(),
        ...(freeDiskBytes !== undefined ? { freeDiskBytes } : {})
      }
    )
  }
  const serviceOwnedRuntimeCloudStorage = state.isServeMode
    ? {
        loadIdentity: getOrCreateHiveRuntimeCloudServiceIdentity,
        readState: readHiveRuntimeCloudServiceRegistrationState,
        saveState: saveHiveRuntimeCloudServiceRegistrationState,
        clearIdentity: clearHiveRuntimeCloudServiceIdentity,
        clearState: clearHiveRuntimeCloudServiceRegistrationState
      }
    : null
  const runtimeCloudPresenceDependencies = serviceOwnedRuntimeCloudStorage
    ? { ...defaultPresenceDependencies, ...serviceOwnedRuntimeCloudStorage }
    : defaultPresenceDependencies
  const processRuntimeCloudPresence = new HiveRuntimeCloudPresenceService(
    runtimeCloudConfig,
    app.getPath('userData'),
    { getReport: getRuntimeCloudReport },
    runtimeCloudPresenceDependencies
  )
  state.runtimeCloudPresence = processRuntimeCloudPresence
  const processRuntimeCloudDirectory = new HiveAccountRuntimeDirectoryService(
    runtimeCloudConfig,
    undefined,
    app.getPath('userData')
  )
  state.runtimeCloudDirectory = processRuntimeCloudDirectory
  const processRuntimeCloudSessions = new HiveAccountRuntimeSessionService(runtimeCloudConfig)
  state.runtimeCloudSessions = processRuntimeCloudSessions
  const processRuntimeCloudTransport = new HiveAccountRuntimeTransport(processRuntimeCloudDirectory)
  state.runtimeCloudTransport = processRuntimeCloudTransport
  state.uninstallRuntimeCloudAccess = installHiveAccountRuntimeAccess({
    directory: processRuntimeCloudDirectory,
    transport: processRuntimeCloudTransport
  })
  const processLocalRuntimeOwnership = new LocalRuntimeOwnershipService({
    config: runtimeCloudConfig,
    userDataPath: app.getPath('userData'),
    getReport: getRuntimeCloudReport,
    getBootId: () => processRuntimeCloudPresence.getBootId(),
    getRelayStatus: getHiveRuntimeRelayStatus,
    onRegistrationChanged: () => processRuntimeCloudPresence.notifyRegistrationChanged(),
    dependencies: serviceOwnedRuntimeCloudStorage
      ? { ...defaultLocalRuntimeOwnershipDependencies, ...serviceOwnedRuntimeCloudStorage }
      : defaultLocalRuntimeOwnershipDependencies
  })
  state.localRuntimeOwnership = processLocalRuntimeOwnership
  state.unsubscribeRuntimeCloudPresenceState = processRuntimeCloudPresence.subscribeState((state) =>
    processLocalRuntimeOwnership.setPresenceState(state)
  )
  if (state.hiveAccountService) {
    state.unsubscribeRuntimeCloudAuthorization =
      state.hiveAccountService.subscribeRuntimeCloudAuthorization((authorization) => {
        processRuntimeCloudDirectory.setAuthorization(authorization)
        processRuntimeCloudSessions.setAuthorization(authorization)
        processLocalRuntimeOwnership.setAuthorization(authorization)
        processRuntimeCloudPresence.setAuthorization(authorization)
      })
    const authorization = state.hiveAccountService.getRuntimeCloudAuthorization()
    processRuntimeCloudDirectory.setAuthorization(authorization)
    processRuntimeCloudSessions.setAuthorization(authorization)
    processLocalRuntimeOwnership.setAuthorization(authorization)
    processRuntimeCloudPresence.setAuthorization(authorization)
  }
}

export function installHiveRuntimeCloudWebLaunch(runtimeRpc: OrcaRuntimeRpcServer): void {
  const runtimeCloudConfig = getHiveRuntimeCloudConfig()
  const processRuntimeCloudPresence = state.runtimeCloudPresence
  if (!processRuntimeCloudPresence) {
    return
  }
  installHiveRuntimeRelay(
    runtimeCloudConfig,
    processRuntimeCloudPresence,
    runtimeRpc,
    app.getPath('userData')
  )
  if (runtimeCloudConfig.enabled && runtimeCloudConfig.webLaunch) {
    const processRuntimeCloudWebLaunch = new HiveRuntimeCloudWebLaunchService({
      apiBaseUrl: runtimeCloudConfig.apiBaseUrl,
      config: runtimeCloudConfig.webLaunch,
      presence: processRuntimeCloudPresence,
      getServerPublicKey: () => runtimeRpc?.getE2EEPublicKey() ?? null,
      terminateSessionConnections: (managedWebSessionId) => {
        runtimeRpc?.terminateCloudWebSessionConnections(managedWebSessionId)
      }
    })
    state.runtimeCloudWebLaunch = processRuntimeCloudWebLaunch
    runtimeRpc.setCloudWebLaunchService(processRuntimeCloudWebLaunch)
    const processRuntimeCloudWebSessionControl = new HiveRuntimeCloudWebSessionControlService({
      apiBaseUrl: runtimeCloudConfig.apiBaseUrl,
      presence: processRuntimeCloudPresence,
      target: processRuntimeCloudWebLaunch
    })
    state.runtimeCloudWebSessionControl = processRuntimeCloudWebSessionControl
    processRuntimeCloudWebSessionControl.start()
  }
}

export function stopHiveRuntimeCloud(): { name: string; promise: Promise<void> }[] {
  const runtimeRelayShutdown = stopHiveRuntimeRelay()
  state.unsubscribeRuntimeCloudAuthorization?.()
  state.unsubscribeRuntimeCloudAuthorization = null
  state.unsubscribeRuntimeCloudPresenceState?.()
  state.unsubscribeRuntimeCloudPresenceState = null
  state.uninstallRuntimeCloudAccess?.()
  state.uninstallRuntimeCloudAccess = null
  state.runtimeCloudTransport?.stop()
  state.runtimeCloudTransport = null
  state.runtimeCloudDirectory?.stop()
  state.runtimeCloudDirectory = null
  state.runtimeCloudSessions?.stop()
  state.runtimeCloudSessions = null
  state.localRuntimeOwnership?.stop()
  state.localRuntimeOwnership = null
  const runtimeCloudWebSessionControlShutdown =
    state.runtimeCloudWebSessionControl?.stop() ?? Promise.resolve()
  state.runtimeCloudWebSessionControl = null
  state.runtimeCloudWebLaunch?.close()
  state.runtimeCloudWebLaunch = null
  const runtimeCloudPresenceShutdown = state.runtimeCloudPresence?.stop() ?? Promise.resolve()
  state.runtimeCloudPresence = null
  state.hiveAccountService = null
  state.hiveAccountStartupState = null
  return [
    { name: 'runtime-relay', promise: runtimeRelayShutdown },
    { name: 'runtime-cloud-presence', promise: runtimeCloudPresenceShutdown },
    { name: 'runtime-cloud-web-session-control', promise: runtimeCloudWebSessionControlShutdown }
  ]
}
