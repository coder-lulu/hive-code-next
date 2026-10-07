import { app } from 'electron'
import { join } from 'node:path'
import { HiveAgentLocalRuntime } from '../native-chat/hive-agent-local-runtime'
import { HiveAccountService } from '../hive-account/hive-account-service'
import { startHiveNativePiBridge } from '../hive-account/hive-native-pi-bridge'
import { getMainHttpClient } from '../network/http-client'
import { piTitlebarExtensionService } from '../pi/titlebar-extension-service'
import { getHiveAccountConfig } from '../hive-account/hive-account-config'
import { HiveAgentLocalPrincipal } from '../native-chat/hive-agent-local-principal'
import { resolveHiveAgentLocalProject } from '../native-chat/hive-agent-local-project'
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
import { HiveMobilePushClient } from '../hive-runtime-cloud/hive-mobile-push-client'
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
import { initializeLocalTasks, stopLocalTasks } from './main-process-tasks'
import {
  getHiveRuntimeRelayStatus,
  installHiveRuntimeRelay,
  stopHiveRuntimeRelay
} from './main-process-hive-runtime-relay'

let nativePiBridge: Promise<Awaited<ReturnType<typeof startHiveNativePiBridge>> | null> | null =
  null

export function initializeHiveAccount(): void {
  const account = new HiveAccountService(app.getPath('userData'))
  state.hiveAccountService = account
  // Keep the shared account generation behind persisted proxy readiness without delaying first paint.
  state.hiveAccountStartupState = state.initialProxyApplicationReady
    .then(() =>
      state.isQuitting ? account.getState() : account.refresh().then((result) => result.state)
    )
    .catch(() => account.getState())
  nativePiBridge = state.hiveAccountStartupState
    .then(() => {
      if (state.isQuitting) {
        return null
      }
      return startHiveNativePiBridge({
        account,
        userDataPath: app.getPath('userData'),
        resourcesDirectory: app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'out'),
        cloudOrigin: () => {
          const config = getHiveAccountConfig()
          return config.configured ? config.config.apiBaseUrl : null
        },
        fetch: (input, init) => getMainHttpClient().fetch(String(input), init),
        prepareAgentDirectory: (directory) => {
          piTitlebarExtensionService.buildPtyEnv('hive-native', directory, 'pi')
        }
      })
    })
    .catch((error) => {
      console.error('HiveCode AI native bridge could not start', error)
      return null
    })
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
  const processLocalRuntimeOwnership = new LocalRuntimeOwnershipService({
    config: runtimeCloudConfig,
    userDataPath: app.getPath('userData'),
    getReport: getRuntimeCloudReport,
    getBootId: () => processRuntimeCloudPresence.getBootId(),
    getCurrentLeaseContext: () => processRuntimeCloudPresence.getCurrentLeaseContext(),
    getRelayStatus: getHiveRuntimeRelayStatus,
    onRegistrationChanged: () => processRuntimeCloudPresence.notifyRegistrationChanged(),
    dependencies: serviceOwnedRuntimeCloudStorage
      ? { ...defaultLocalRuntimeOwnershipDependencies, ...serviceOwnedRuntimeCloudStorage }
      : defaultLocalRuntimeOwnershipDependencies
  })
  state.localRuntimeOwnership = processLocalRuntimeOwnership
  runtimeService.setMobileNotificationRemotePushSink(
    runtimeCloudConfig.enabled
      ? new HiveMobilePushClient({
          apiBaseUrl: runtimeCloudConfig.apiBaseUrl,
          getAuthorization: () => state.hiveAccountService?.getRuntimeCloudAuthorization() ?? null,
          getRuntimeId: () => processLocalRuntimeOwnership.getLocalRuntimeStatus().runtimeRecordId
        })
      : null
  )
  if (state.hiveAccountService && state.store && !state.isServeMode) {
    const projectStore = state.store
    state.hiveAgentLocalPrincipal = new HiveAgentLocalPrincipal(
      state.hiveAccountService,
      processLocalRuntimeOwnership,
      getHiveAccountConfig,
      (selector) => resolveHiveAgentLocalProject(runtimeService, projectStore, selector)
    )
    state.hiveAgentLocalRuntime = new HiveAgentLocalRuntime({
      account: state.hiveAccountService,
      presence: processRuntimeCloudPresence,
      principal: state.hiveAgentLocalPrincipal,
      runtime: runtimeService,
      getConfig: getHiveAccountConfig,
      resourcesDirectory: app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'out')
    })
  }
  state.uninstallRuntimeCloudAccess = installHiveAccountRuntimeAccess({
    directory: processRuntimeCloudDirectory,
    transport: processRuntimeCloudTransport,
    getLocalRuntimeRecordId: () =>
      processLocalRuntimeOwnership.getLocalRuntimeStatus().runtimeRecordId
  })
  state.unsubscribeRuntimeCloudPresenceState = processRuntimeCloudPresence.subscribeState((state) =>
    processLocalRuntimeOwnership.setPresenceState(state)
  )
  if (state.hiveAccountService) {
    const hiveAccountService = state.hiveAccountService
    const consumers = [
      processRuntimeCloudPresence,
      processRuntimeCloudDirectory,
      processRuntimeCloudSessions,
      processLocalRuntimeOwnership
    ]
    const subscriptions = consumers.map((consumer) =>
      hiveAccountService.subscribeRuntimeCloudAuthorization((authorization) =>
        consumer.setAuthorization(authorization)
      )
    )
    state.unsubscribeRuntimeCloudAuthorization = () =>
      subscriptions.forEach((unsubscribe) => unsubscribe())
    const authorization = hiveAccountService.getRuntimeCloudAuthorization()
    for (const consumer of consumers) {
      consumer.setAuthorization(authorization)
    }
  }
  initializeLocalTasks()
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
  const localRuntime = state.hiveAgentLocalRuntime
  const hiveAgentShutdown = (localRuntime?.close() ?? Promise.resolve()).then(() => {
    if (state.hiveAgentLocalRuntime === localRuntime) {
      state.hiveAgentLocalRuntime = null
    }
  })
  const runtimeRelayShutdown = stopHiveRuntimeRelay()
  state.hiveAgentLocalPrincipal?.stop()
  state.hiveAgentLocalPrincipal = null
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
    { name: 'hive-tasks', promise: stopLocalTasks() },
    {
      name: 'hive-native-pi',
      promise: (nativePiBridge ?? Promise.resolve(null)).then((bridge) => bridge?.close())
    },
    { name: 'hive-agent', promise: hiveAgentShutdown },
    { name: 'runtime-relay', promise: runtimeRelayShutdown },
    { name: 'runtime-cloud-presence', promise: runtimeCloudPresenceShutdown },
    { name: 'runtime-cloud-web-session-control', promise: runtimeCloudWebSessionControlShutdown }
  ]
}
