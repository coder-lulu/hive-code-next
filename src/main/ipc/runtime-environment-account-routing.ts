import { listEnvironments } from '../../shared/runtime-environment-store'
import type { HiveAccountRuntimeDirectoryState } from '../../shared/hive-runtime-cloud'
import {
  redactRuntimeEnvironment,
  type PublicKnownRuntimeEnvironment
} from '../../shared/runtime-environments'
import type { RemoteRuntimeSubscription } from '../../shared/remote-runtime-client'
import { RemoteRuntimeClientError } from '../../shared/remote-runtime-client-error'
import type {
  RuntimeOrchestrationEnvelope,
  RuntimeRpcResponse
} from '../../shared/runtime-rpc-envelope'
import type { RuntimeStatus } from '../../shared/runtime-types'
import { getHiveAccountRuntimeAccess } from '../hive-runtime-cloud/hive-account-runtime-access'
import {
  mergeHiveAccountRuntimeCatalog,
  resolveHiveRuntimeCatalogEntry
} from '../hive-runtime-cloud/hive-runtime-catalog'
import {
  callRuntimeEnvironment,
  getRuntimeEnvironmentStatus,
  subscribeRuntimeEnvironment
} from './runtime-environment-transport-routing'

export function listRuntimeEnvironmentCatalog(
  userDataPath: string
): PublicKnownRuntimeEnvironment[] {
  const local = listEnvironments(userDataPath).map(redactRuntimeEnvironment)
  const access = getHiveAccountRuntimeAccess()
  const state = access?.directory.getState()
  const accountRuntimes = state?.items ?? []
  const localRuntimeRecordId = access?.getLocalRuntimeRecordId()
  return mergeHiveAccountRuntimeCatalog(
    local.filter(
      (environment) => !localRuntimeRecordId || environment.runtimeRecordId !== localRuntimeRecordId
    ),
    accountRuntimes.filter((runtime) => runtime.runtimeRecordId !== localRuntimeRecordId),
    pendingDisplayNameMap(state)
  )
}

export function resolveRuntimeEnvironmentCatalogEntry(
  userDataPath: string,
  selector: string
): PublicKnownRuntimeEnvironment {
  const local = listEnvironments(userDataPath).map(redactRuntimeEnvironment)
  const access = getHiveAccountRuntimeAccess()
  const state = access?.directory.getState()
  const accountRuntimes = state?.items ?? []
  const pending = pendingDisplayNameMap(state)
  const environment = resolveHiveRuntimeCatalogEntry(local, accountRuntimes, pending, selector)
  const localRuntimeRecordId = access?.getLocalRuntimeRecordId()
  if (localRuntimeRecordId && environment.runtimeRecordId === localRuntimeRecordId) {
    throw new Error('This Runtime is the current computer; use the local workspace.')
  }
  return environment
}

function pendingDisplayNameMap(
  state: HiveAccountRuntimeDirectoryState | undefined
): ReadonlyMap<string, string | null> {
  return new Map(
    (state?.pendingDisplayNames ?? []).map((pending) => [
      pending.runtimeRecordId,
      pending.desiredName
    ])
  )
}

export async function getEnvironmentStatusWithCloudFallback(
  userDataPath: string,
  environment: PublicKnownRuntimeEnvironment,
  timeoutMs?: number,
  options?: { observeOnly?: true }
): Promise<RuntimeRpcResponse<RuntimeStatus>> {
  let localResponse: RuntimeRpcResponse<RuntimeStatus> | null = null
  if (hasLocalPairing(environment)) {
    localResponse = await getRuntimeEnvironmentStatus(
      userDataPath,
      environment.id,
      timeoutMs,
      options
    )
    if (
      localResponse.ok ||
      !environment.accountClaim ||
      localResponse.error.code !== 'runtime_unavailable'
    ) {
      return localResponse
    }
  }
  const access = getHiveAccountRuntimeAccess()
  if (environment.accountClaim && access) {
    return access.transport.getStatus(environment.accountClaim, timeoutMs)
  }
  return (
    localResponse ?? unavailableResponse(environment, 'Cloud Runtime transport is not available.')
  )
}

export async function callEnvironmentWithCloudFallback(
  userDataPath: string,
  environment: PublicKnownRuntimeEnvironment,
  method: string,
  params: unknown,
  timeoutMs?: number,
  expectedEnvironmentPairingRevision?: number,
  envelope?: RuntimeOrchestrationEnvelope
): Promise<RuntimeRpcResponse<unknown>> {
  const local = hasLocalPairing(environment)
  if (local) {
    try {
      return await callRuntimeEnvironment(
        userDataPath,
        environment.id,
        method,
        params,
        timeoutMs,
        expectedEnvironmentPairingRevision,
        envelope
      )
    } catch (error) {
      if (!environment.accountClaim || !isPreDeliveryConnectionFailure(error)) {
        throw error
      }
    }
  }
  if (
    expectedEnvironmentPairingRevision !== undefined &&
    !local &&
    expectedEnvironmentPairingRevision !== environment.pairingRevision
  ) {
    throw new Error('Runtime environment pairing changed; refresh and try again')
  }
  const access = getHiveAccountRuntimeAccess()
  if (!environment.accountClaim || !access) {
    throw new RemoteRuntimeClientError(
      'remote_runtime_unavailable',
      'Cloud Runtime transport is not available.'
    )
  }
  return access.transport.call(environment.accountClaim, method, params, timeoutMs, envelope)
}

export async function subscribeEnvironmentWithCloudFallback(
  userDataPath: string,
  environment: PublicKnownRuntimeEnvironment,
  method: string,
  params: unknown,
  timeoutMs: number | undefined,
  callbacks: {
    onEvent: (
      payload:
        | { type: 'response'; response: RuntimeRpcResponse<unknown> }
        | { type: 'binary'; bytes: Uint8Array<ArrayBufferLike> }
        | { type: 'error'; code: string; message: string }
        | { type: 'close' }
    ) => void
    onClose: () => void
  }
): Promise<RemoteRuntimeSubscription> {
  if (hasLocalPairing(environment)) {
    try {
      return await subscribeRuntimeEnvironment(
        userDataPath,
        environment.id,
        method,
        params,
        timeoutMs,
        callbacks
      )
    } catch (error) {
      if (!environment.accountClaim || !isPreDeliveryConnectionFailure(error)) {
        throw error
      }
    }
  }
  const access = getHiveAccountRuntimeAccess()
  if (!environment.accountClaim || !access) {
    throw new RemoteRuntimeClientError(
      'remote_runtime_unavailable',
      'Cloud Runtime transport is not available.'
    )
  }
  return access.transport.subscribe(environment.accountClaim, method, params, timeoutMs, {
    onResponse: (response) => callbacks.onEvent({ type: 'response', response }),
    onBinary: (bytes) => callbacks.onEvent({ type: 'binary', bytes }),
    onError: (error) => callbacks.onEvent({ type: 'error', ...error }),
    onClose: () => {
      callbacks.onEvent({ type: 'close' })
      callbacks.onClose()
    }
  })
}

function hasLocalPairing(environment: PublicKnownRuntimeEnvironment): boolean {
  return environment.accessSources?.includes('local-pairing') ?? !environment.accountClaim
}

function isConnectionFailure(error: unknown): boolean {
  return (
    error instanceof RemoteRuntimeClientError &&
    (error.code === 'remote_runtime_unavailable' || error.code === 'runtime_timeout')
  )
}

export function isPreDeliveryConnectionFailure(error: unknown): boolean {
  return (
    isConnectionFailure(error) &&
    error instanceof RemoteRuntimeClientError &&
    (error.pairingStage === 'connect' || error.pairingStage === 'host-identity')
  )
}

function unavailableResponse(
  environment: PublicKnownRuntimeEnvironment,
  message: string
): RuntimeRpcResponse<never> {
  return {
    id: 'status.get',
    ok: false,
    error: { code: 'runtime_unavailable', message },
    _meta: { runtimeId: environment.runtimeId ?? environment.runtimeRecordId ?? environment.id }
  }
}
