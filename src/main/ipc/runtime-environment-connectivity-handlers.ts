import { ipcMain } from 'electron'
import {
  addEnvironmentFromPairingCode,
  removeEnvironment,
  resolveEnvironment
} from '../../shared/runtime-environment-store'
import {
  isWslHostRuntimeEnvironment,
  usesAccountRuntimeRelay,
  redactRuntimeEnvironment,
  type PublicKnownRuntimeEnvironment
} from '../../shared/runtime-environments'
import { RemoteRuntimeClientError } from '../../shared/remote-runtime-client-error'
import { RuntimeRpcCallQueueOverloadError } from '../../shared/runtime-rpc-call-queue'
import type { RuntimeRpcFailure, RuntimeRpcResponse } from '../../shared/runtime-rpc-envelope'
import type { RuntimeStatus } from '../../shared/runtime-types'
import type { Store } from '../persistence'
import { getHiveAccountRuntimeAccess } from '../hive-runtime-cloud/hive-account-runtime-access'
import {
  callCatalogEnvironment,
  getCatalogEnvironmentStatus,
  listRuntimeEnvironmentCatalog,
  resolveRuntimeEnvironmentCatalogEntry
} from './runtime-environment-account-routing'
import { retireRemovedRuntimeEnvironment } from './runtime-environment-removal-cleanup'
import { readSettingsWithRuntimeEnvironmentPreference } from './runtime-environment-preference'
import { verifyAndAddRuntimeEnvironmentFromPairingCode } from './runtime-environment-pairing-verification'
import {
  closeRemoteRuntimeRequestConnection,
  getRuntimeEnvironmentStatusOwner,
  getRuntimeEnvironmentStatusSnapshots,
  retryRemoteRuntimeSharedControlConnectionNow
} from './runtime-environment-request-connections'
import {
  clearRuntimeEnvironmentManualDisconnect,
  isRuntimeEnvironmentManuallyDisconnected,
  markRuntimeEnvironmentManuallyDisconnected,
  manuallyDisconnectedResponse
} from './runtime-environment-manual-disconnect'
import { callRuntimeEnvironment } from './runtime-environment-transport-routing'
import { withWslOrcadAccountEnv } from '../wsl/wsl-orcad-account-env'
import { clearSshCredentialDeclinedForEnvironment } from '../ssh/ssh-credential-decline'
import {
  observeWslOrcadHostResponse,
  wslOrcadHostSupports
} from '../wsl/wsl-orcad-host-environments'
import { getWslHostService } from '../wsl/wsl-host-service-instance'
import { assertWslHostReachable } from '../wsl/wsl-host-gate'

export { isRuntimeEnvironmentManuallyDisconnected }

type ConnectivityHandlerOptions = {
  store: Store
  getUserDataPath: () => string
  invalidateTransport: (environmentId: string) => Promise<void> | void
}

export function registerRuntimeEnvironmentConnectivityHandlers({
  store,
  getUserDataPath,
  invalidateTransport
}: ConnectivityHandlerOptions): void {
  ipcMain.handle('runtimeEnvironments:getStatusSnapshots', () =>
    getRuntimeEnvironmentStatusSnapshots()
  )
  ipcMain.handle('runtimeEnvironments:list', () => {
    readSettingsWithRuntimeEnvironmentPreference(store, getUserDataPath())
    return listRuntimeEnvironmentCatalog(getUserDataPath())
  })
  ipcMain.handle(
    'runtimeEnvironments:addFromPairingCode',
    (
      _event,
      args: { name: string; pairingCode: string }
    ): { environment: PublicKnownRuntimeEnvironment } => {
      const environment = addEnvironmentFromPairingCode(getUserDataPath(), args)
      clearRuntimeEnvironmentManualDisconnect(environment.id)
      return { environment: redactRuntimeEnvironment(environment) }
    }
  )
  ipcMain.handle(
    'runtimeEnvironments:verifyAndAddFromPairingCode',
    async (_event, args: { name: string; pairingCode: string; allowLoopback?: boolean }) => {
      const result = await verifyAndAddRuntimeEnvironmentFromPairingCode(getUserDataPath(), args)
      if (result.ok) {
        clearRuntimeEnvironmentManualDisconnect(result.environment.id)
        getRuntimeEnvironmentStatusOwner(getUserDataPath(), result.environment.id).acceptVerified({
          id: 'status.get',
          ok: true,
          result: result.runtimeStatus,
          _meta: { runtimeId: result.runtimeStatus.runtimeId }
        })
      }
      return result
    }
  )
  ipcMain.handle('runtimeEnvironments:resolve', (_event, args: { selector: string }) =>
    resolveRuntimeEnvironmentCatalogEntry(getUserDataPath(), args.selector)
  )
  ipcMain.handle(
    'runtimeEnvironments:remove',
    (
      _event,
      args: { selector: string }
    ):
      | { removed: PublicKnownRuntimeEnvironment }
      | Promise<{ removed: PublicKnownRuntimeEnvironment }> => {
      const environment = resolveEnvironment(getUserDataPath(), args.selector)
      if (store.getSettings().activeRuntimeEnvironmentId === environment.id) {
        throw new Error(
          'This server is the default host for new projects. Choose another one in Advanced before removing it.'
        )
      }
      // A closed gate leaves persisted WSL hosts untouched on disk.
      assertWslHostReachable(environment)
      const wsl = isWslHostRuntimeEnvironment(environment) ? getWslHostService() : null
      if (wsl) {
        // Also releases the distro's holder and drops the WSL record.
        return wsl
          .remove(environment.id)
          .then(() => ({ removed: redactRuntimeEnvironment(environment) }))
      }
      const removed = removeEnvironment(getUserDataPath(), args.selector)
      void retireRemovedRuntimeEnvironment(removed.id, invalidateTransport, store)
      closeLegacySelectorTransport(args.selector, removed.id)
      return { removed: redactRuntimeEnvironment(removed) }
    }
  )
  ipcMain.handle(
    'runtimeEnvironments:disconnect',
    (_event, args: { selector: string }): { disconnected: PublicKnownRuntimeEnvironment } => {
      const environment = resolveRuntimeEnvironmentCatalogEntry(getUserDataPath(), args.selector)
      markRuntimeEnvironmentManuallyDisconnected(environment.id)
      invalidateTransport(environment.id)
      if (environment.accountClaim) {
        getHiveAccountRuntimeAccess()?.transport.disconnect(
          environment.accountClaim.runtimeRecordId
        )
      }
      closeLegacySelectorTransport(args.selector, environment.id)
      if (environment.accessSources?.includes('local-pairing') ?? !environment.accountClaim) {
        getRuntimeEnvironmentStatusOwner(getUserDataPath(), environment.id)
      }
      return { disconnected: environment }
    }
  )
  ipcMain.handle(
    'runtimeEnvironments:connect',
    async (
      _event,
      args: { selector: string; timeoutMs?: number }
    ): Promise<RuntimeRpcResponse<RuntimeStatus>> => {
      const environment = resolveRuntimeEnvironmentCatalogEntry(getUserDataPath(), args.selector)
      assertWslHostReachable(environment)
      clearRuntimeEnvironmentManualDisconnect(environment.id)
      clearSshCredentialDeclinedForEnvironment(environment)
      if (isWslHostRuntimeEnvironment(environment)) {
        await getWslHostService()?.connect(environment.id)
      }
      return getCatalogEnvironmentStatus(getUserDataPath(), environment, args.timeoutMs, {
        reconnect: true
      })
    }
  )
  ipcMain.handle(
    'runtimeEnvironments:retryControlConnection',
    async (_event, args: { selector: string }): Promise<void> => {
      const environment = resolveRuntimeEnvironmentCatalogEntry(getUserDataPath(), args.selector)
      if (isRuntimeEnvironmentManuallyDisconnected(environment.id)) {
        return
      }
      if (usesAccountRuntimeRelay(environment) && environment.accountClaim) {
        getHiveAccountRuntimeAccess()?.transport.disconnect(
          environment.accountClaim.runtimeRecordId
        )
        await getCatalogEnvironmentStatus(getUserDataPath(), environment, undefined, {
          reconnect: true
        })
        return
      }
      retryRemoteRuntimeSharedControlConnectionNow(environment.id)
    }
  )
}

export function registerRuntimeEnvironmentPassiveHandlers(getUserDataPath: () => string): void {
  registerPassiveStatusHandler(getUserDataPath)
  registerPassiveCallHandler(getUserDataPath)
}

function closeLegacySelectorTransport(selector: string, environmentId: string): void {
  if (selector === environmentId) {
    return
  }
  closeRemoteRuntimeRequestConnection(selector)
}

function registerPassiveStatusHandler(getUserDataPath: () => string): void {
  ipcMain.handle(
    'runtimeEnvironments:getStatus',
    async (
      _event,
      args: { selector: string; timeoutMs?: number; observeOnly?: true }
    ): Promise<RuntimeRpcResponse<RuntimeStatus>> => {
      const environment = resolveRuntimeEnvironmentCatalogEntry(getUserDataPath(), args.selector)
      if (isRuntimeEnvironmentManuallyDisconnected(environment.id)) {
        return manuallyDisconnectedResponse(environment)
      }
      const response = await getCatalogEnvironmentStatus(
        getUserDataPath(),
        environment,
        args.timeoutMs,
        args.observeOnly ? { observeOnly: true } : undefined
      )
      observeWslOrcadHostResponse(environment.id, 'status.get', response)
      return isRuntimeEnvironmentManuallyDisconnected(environment.id)
        ? manuallyDisconnectedResponse(environment)
        : response
    }
  )
}

function runtimeEnvironmentCallFailure(
  environment: PublicKnownRuntimeEnvironment,
  method: string,
  error: unknown
): RuntimeRpcFailure | null {
  if (
    !(error instanceof RemoteRuntimeClientError) &&
    !(error instanceof RuntimeRpcCallQueueOverloadError)
  ) {
    return null
  }
  return {
    id: method,
    ok: false,
    error: { code: error.code, message: error.message },
    _meta: { runtimeId: environment.runtimeId ?? environment.runtimeRecordId ?? environment.id }
  }
}

function registerPassiveCallHandler(getUserDataPath: () => string): void {
  ipcMain.handle(
    'runtimeEnvironments:call',
    async (
      _event,
      args: {
        selector: string
        method: string
        params?: unknown
        timeoutMs?: number
        expectedEnvironmentPairingRevision?: number
        expectedEnvironmentRuntimeId?: string
      }
    ): Promise<RuntimeRpcResponse<unknown>> => {
      const catalogEnvironment = resolveRuntimeEnvironmentCatalogEntry(
        getUserDataPath(),
        args.selector
      )
      if (isRuntimeEnvironmentManuallyDisconnected(catalogEnvironment.id)) {
        return manuallyDisconnectedResponse(catalogEnvironment)
      }
      // Why here: every renderer call to a paired host passes this one handler.
      const accounts = await withWslOrcadAccountEnv({
        environmentId: catalogEnvironment.id,
        method: args.method,
        params: args.params,
        hostSupports: (capability) =>
          wslOrcadHostSupports(catalogEnvironment.id, capability, () =>
            callRuntimeEnvironment(
              getUserDataPath(),
              catalogEnvironment.id,
              'status.get',
              undefined
            )
          )
      })
      if (!accounts.ok) {
        return {
          id: args.method,
          ok: false,
          error: { code: 'account_preparation_failed', message: accounts.message },
          _meta: { runtimeId: catalogEnvironment.runtimeId }
        }
      }
      let response: RuntimeRpcResponse<unknown>
      try {
        response = await callCatalogEnvironment(
          getUserDataPath(),
          catalogEnvironment,
          args.method,
          accounts.params,
          args.timeoutMs,
          args.expectedEnvironmentPairingRevision,
          undefined,
          { expectedEnvironmentRuntimeId: args.expectedEnvironmentRuntimeId }
        )
      } catch (error) {
        const failure = runtimeEnvironmentCallFailure(catalogEnvironment, args.method, error)
        if (failure) {
          return failure
        }
        throw error
      }
      observeWslOrcadHostResponse(catalogEnvironment.id, args.method, response)
      return isRuntimeEnvironmentManuallyDisconnected(catalogEnvironment.id)
        ? manuallyDisconnectedResponse(catalogEnvironment)
        : response
    }
  )
}
