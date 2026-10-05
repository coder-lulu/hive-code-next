import type {
  RuntimeHostStatusSnapshot,
  RuntimeHostStatusResponse
} from '../../../../shared/runtime-host-status'
import { RuntimeRpcCallQueuePool } from '../../../../shared/runtime-rpc-call-queue'
import type { RuntimeRpcResponse } from '../../../../shared/runtime-rpc-envelope'
import { WebRuntimeClient } from '../web-runtime-client'
import {
  clearStoredWebRuntimeEnvironment,
  getPreferredWebPairingOffer,
  readStoredWebRuntimeEnvironment,
  updateStoredEnvironmentRuntimeId
} from '../web-runtime-environment'
import type { StoredWebRuntimeEnvironment } from '../web-runtime-environment'
import type { CloudLaunchBootstrap } from '../cloud-launch-bootstrap'
import {
  accountRuntimeEnvironment,
  type WebAccountBootstrap
} from '../account-runtime-relay/WebAccountConnect'
import {
  createWebAccountRelayClient,
  type WebAccountRuntimeClient
} from '../account-runtime-relay/web-account-relay-client'
import { APP_DISPLAY_NAME } from '@/product-brand'
import {
  cloudEnvironmentId,
  createVolatileCloudEnvironment,
  manuallyDisconnectedResponse
} from './web-runtime-session-presentation'
export { manuallyDisconnectedResponse } from './web-runtime-session-presentation'
import { webRuntimeState } from './web-runtime-state'
export { webRuntimeState } from './web-runtime-state'
import {
  WebRuntimeDisplayProjection,
  type WebRuntimeDisplayOwner
} from './web-runtime-display-projection'
export {
  WebRuntimeDisplayMetadataError,
  type WebRuntimeDisplayOwner
} from './web-runtime-display-projection'

const statusListeners = new Set<(snapshot: RuntimeHostStatusSnapshot) => void>()
const displayProjection = new WebRuntimeDisplayProjection(
  webRuntimeState,
  removeActiveRuntimeEnvironment
)

export const captureWebRuntimeDisplayOwner = (): WebRuntimeDisplayOwner | null =>
  displayProjection.capture()

export function isCurrentWebRuntimeDisplayOwner(owner: WebRuntimeDisplayOwner): boolean {
  return displayProjection.current(owner)
}

export async function mergeWebRuntimeDisplayMetadata(
  owner: WebRuntimeDisplayOwner,
  value: unknown
): Promise<boolean> {
  return displayProjection.merge(owner, value)
}

export function clearWebRuntimeDisplayProjection(owner: WebRuntimeDisplayOwner): void {
  displayProjection.clear(owner)
}

function webRuntimeStatusOptions(environment: StoredWebRuntimeEnvironment) {
  const generation = displayProjection.generation
  return {
    environmentId: environment.id,
    pairingRevision: environment.pairingRevision ?? environment.createdAt,
    publish: (snapshot: RuntimeHostStatusSnapshot) => {
      if (generation !== displayProjection.generation) {
        return
      }
      for (const listener of statusListeners) {
        listener(snapshot)
      }
    },
    verified: (response: RuntimeHostStatusResponse) => {
      if (generation === displayProjection.generation) {
        updateEnvironmentFromResponse(environment, response)
      }
    }
  }
}

export function configureWebRuntimeBootstrap(
  cloudBootstrap?: CloudLaunchBootstrap,
  accountBootstrap?: WebAccountBootstrap
): void {
  const nextAccount = accountBootstrap ?? null
  const nextCloud = cloudBootstrap ?? null
  if (
    nextAccount === webRuntimeState.activeAccountBootstrap &&
    nextCloud === webRuntimeState.activeCloudBootstrap &&
    (nextAccount || nextCloud) &&
    webRuntimeState.activeEnvironment
  ) {
    return
  }
  displayProjection.reset(nextAccount, nextCloud)
  if (
    nextAccount !== webRuntimeState.activeAccountBootstrap ||
    nextCloud !== webRuntimeState.activeCloudBootstrap
  ) {
    closeActiveRuntimeClients()
    webRuntimeState.activeAccountBootstrap?.session.close()
  }
  webRuntimeState.activeAccountBootstrap = nextAccount
  webRuntimeState.activeCloudBootstrap = nextCloud
  webRuntimeState.activeEnvironment = nextAccount
    ? accountRuntimeEnvironment(nextAccount.runtime)
    : cloudBootstrap
      ? createVolatileCloudEnvironment(cloudBootstrap)
      : readStoredWebRuntimeEnvironment()
  if (webRuntimeState.activeEnvironment) {
    displayProjection.track(webRuntimeState.activeEnvironment)
  }
  if (nextAccount && webRuntimeState.activeEnvironment) {
    webRuntimeState.activeClient = nextAccount.client
    webRuntimeState.activeClientEnvironmentId = webRuntimeState.activeEnvironment.id
    webRuntimeState.activeClient.configureStatusOwner?.(
      webRuntimeStatusOptions(webRuntimeState.activeEnvironment)
    )
  }
}
export function subscribeWebRuntimeStatus(
  callback: (snapshot: RuntimeHostStatusSnapshot) => void
): () => void {
  statusListeners.add(callback)
  return () => {
    statusListeners.delete(callback)
  }
}
export function readWebRuntimeStatusSnapshots(): RuntimeHostStatusSnapshot[] {
  const snapshot = webRuntimeState.activeClient?.statusOwner?.read()
  return snapshot ? [snapshot] : []
}
export async function observeWebRuntimeStatus(
  selector: string,
  timeoutMs?: number
): Promise<RuntimeHostStatusResponse> {
  const environment = resolveEnvironment(selector)
  if (manuallyDisconnectedEnvironmentIds.has(environment.id)) {
    return manuallyDisconnectedResponse(environment)
  }
  const existing = webRuntimeState.activeClient?.statusOwner
  if (existing) {
    return existing.refresh({ timeoutMs, observeOnly: true })
  }
  if (webRuntimeState.activeAccountBootstrap) {
    return (await getClientForEnvironment(environment).call('status.get', undefined, {
      timeoutMs
    })) as RuntimeHostStatusResponse
  }
  const transient = new WebRuntimeClient(
    webRuntimeState.activeCloudBootstrap &&
      environment.id === cloudEnvironmentId(webRuntimeState.activeCloudBootstrap)
      ? webRuntimeState.activeCloudBootstrap
      : getPreferredWebPairingOffer(environment),
    {
      reconnect: false
    }
  )
  try {
    return (await transient.call('status.get', undefined, {
      timeoutMs
    })) as RuntimeHostStatusResponse
  } finally {
    transient.close()
  }
}

export const manuallyDisconnectedEnvironmentIds = new Set<string>()

export const runtimeCallQueuePool = new RuntimeRpcCallQueuePool()

export function invalidateRuntimeWorktreeCaches(): void {
  webRuntimeState.cachedWorktrees = null
  webRuntimeState.cachedDetectedWorktrees = null
}

export function getClientForEnvironment(
  environment: StoredWebRuntimeEnvironment
): WebAccountRuntimeClient {
  if (manuallyDisconnectedEnvironmentIds.has(environment.id)) {
    throw new Error('runtime_manually_disconnected')
  }
  if (
    !webRuntimeState.activeClient ||
    webRuntimeState.activeClientEnvironmentId !== environment.id
  ) {
    webRuntimeState.activeClient?.close()
    const account = webRuntimeState.activeAccountBootstrap
    webRuntimeState.activeClient =
      account && environment.id === `account-${account.runtime.runtimeRecordId}`
        ? createWebAccountRelayClient(() => account.session.material(account.runtime))
        : new WebRuntimeClient(
            webRuntimeState.activeCloudBootstrap &&
              environment.id === cloudEnvironmentId(webRuntimeState.activeCloudBootstrap)
              ? webRuntimeState.activeCloudBootstrap
              : getPreferredWebPairingOffer(environment),
            { status: webRuntimeStatusOptions(environment) }
          )
    webRuntimeState.activeClientEnvironmentId = environment.id
  }
  webRuntimeState.activeClient.configureStatusOwner?.(webRuntimeStatusOptions(environment))
  return webRuntimeState.activeClient
}

export function closeActiveRuntimeClients(): void {
  webRuntimeState.activeClient?.close()
  webRuntimeState.activeClient = null
  webRuntimeState.activeClientEnvironmentId = null
  invalidateRuntimeWorktreeCaches()
}

export function disconnectActiveRuntimeEnvironment(): void {
  closeActiveRuntimeClients()
}

export function removeActiveRuntimeEnvironment(): void {
  displayProjection.reset(null, null)
  disconnectActiveRuntimeEnvironment()
  if (webRuntimeState.activeAccountBootstrap) {
    webRuntimeState.activeAccountBootstrap.session.close()
    webRuntimeState.activeAccountBootstrap = null
  } else if (webRuntimeState.activeCloudBootstrap) {
    webRuntimeState.activeCloudBootstrap = null
  } else {
    clearStoredWebRuntimeEnvironment()
  }
  webRuntimeState.activeEnvironment = null
}

export function resolveEnvironment(selector: string): StoredWebRuntimeEnvironment {
  const environment = requireActiveEnvironment()
  if (selector === environment.id || selector === environment.name || selector === 'active') {
    return environment
  }
  if (environment.compatibleEnvironmentIds?.includes(selector)) {
    return environment
  }
  throw new Error(`Unknown ${APP_DISPLAY_NAME} runtime environment: ${selector}`)
}

export function requireActiveEnvironment(): StoredWebRuntimeEnvironment {
  webRuntimeState.activeEnvironment =
    webRuntimeState.activeEnvironment ?? readStoredWebRuntimeEnvironment()
  if (!webRuntimeState.activeEnvironment) {
    throw new Error(`Pair this web client with a ${APP_DISPLAY_NAME} server first.`)
  }
  return webRuntimeState.activeEnvironment
}

export function requireActiveEnvironmentOrNull(): StoredWebRuntimeEnvironment | null {
  webRuntimeState.activeEnvironment =
    webRuntimeState.activeEnvironment ?? readStoredWebRuntimeEnvironment()
  return webRuntimeState.activeEnvironment
}

export function assertActiveEnvironment(environmentId: string): void {
  if (requireActiveEnvironment().id !== environmentId) {
    throw new Error(
      `The paired ${APP_DISPLAY_NAME} server changed while the request was in progress.`
    )
  }
}

export function updateEnvironmentFromResponse(
  environment: StoredWebRuntimeEnvironment,
  response: RuntimeRpcResponse<unknown>
): void {
  const current = webRuntimeState.activeEnvironment
  if (!current || !displayProjection.currentEnvironment(environment)) {
    return
  }
  const runtimeId = response.ok ? response._meta.runtimeId : (response._meta?.runtimeId ?? null)
  const pairedDeviceId =
    response.ok &&
    typeof response.result === 'object' &&
    response.result !== null &&
    typeof (response.result as { pairedDeviceId?: unknown }).pairedDeviceId === 'string'
      ? (response.result as { pairedDeviceId: string }).pairedDeviceId
      : undefined
  if (
    (webRuntimeState.activeCloudBootstrap &&
      environment.id === cloudEnvironmentId(webRuntimeState.activeCloudBootstrap)) ||
    (webRuntimeState.activeAccountBootstrap &&
      environment.id ===
        `account-${webRuntimeState.activeAccountBootstrap.runtime.runtimeRecordId}`)
  ) {
    if (runtimeId === current.runtimeId) {
      return
    }
    webRuntimeState.activeEnvironment = {
      ...current,
      runtimeId,
      updatedAt: Date.now(),
      lastUsedAt: Date.now()
    }
    displayProjection.track(webRuntimeState.activeEnvironment)
    void displayProjection.publish(webRuntimeState.activeEnvironment).catch(() => undefined)
    return
  }
  webRuntimeState.activeEnvironment = updateStoredEnvironmentRuntimeId(
    current,
    runtimeId,
    pairedDeviceId
  )
}
