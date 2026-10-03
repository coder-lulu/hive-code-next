import type {
  RuntimeHostStatusSnapshot,
  RuntimeHostStatusResponse
} from '../../../../shared/runtime-host-status'
import type { WorktreeVisibilityDefaults } from '../../../../shared/global-settings-types'
import { RuntimeRpcCallQueuePool } from '../../../../shared/runtime-rpc-call-queue'
import type { RuntimeRpcResponse } from '../../../../shared/runtime-rpc-envelope'
import type { Worktree } from '../../../../shared/worktree/types'
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
import { translate } from '@/i18n/i18n'
import { APP_DISPLAY_NAME } from '@/product-brand'

export const webRuntimeState: {
  activeEnvironment: StoredWebRuntimeEnvironment | null
  activeCloudBootstrap: CloudLaunchBootstrap | null
  activeAccountBootstrap: WebAccountBootstrap | null
  worktreeVisibilityDefaultsRuntimeEnvironmentId: string | null
  worktreeVisibilityDefaultsRuntimeValue: WorktreeVisibilityDefaults | null
  activeClient: WebAccountRuntimeClient | null
  activeClientEnvironmentId: string | null
  cachedWorktrees: { loadedAt: number; worktrees: Worktree[] } | null
  cachedDetectedWorktrees: { loadedAt: number; worktrees: Worktree[] } | null
} = {
  activeEnvironment: readStoredWebRuntimeEnvironment(),
  activeCloudBootstrap: null,
  activeAccountBootstrap: null,
  worktreeVisibilityDefaultsRuntimeEnvironmentId: null,
  worktreeVisibilityDefaultsRuntimeValue: null,
  activeClient: null,
  activeClientEnvironmentId: null,
  cachedWorktrees: null,
  cachedDetectedWorktrees: null
}

const statusListeners = new Set<(snapshot: RuntimeHostStatusSnapshot) => void>()

function webRuntimeStatusOptions(environment: StoredWebRuntimeEnvironment) {
  return {
    environmentId: environment.id,
    pairingRevision: environment.pairingRevision ?? environment.createdAt,
    publish: (snapshot: RuntimeHostStatusSnapshot) => {
      for (const listener of statusListeners) {
        listener(snapshot)
      }
    },
    verified: (response: RuntimeHostStatusResponse) => updateEnvironmentFromResponse(environment, response)
  }
}

export function configureWebRuntimeBootstrap(
  cloudBootstrap?: CloudLaunchBootstrap,
  accountBootstrap?: WebAccountBootstrap
): void {
  const nextAccount = accountBootstrap ?? null
  if (nextAccount !== webRuntimeState.activeAccountBootstrap) {
    closeActiveRuntimeClients()
    webRuntimeState.activeAccountBootstrap?.session.close()
  }
  webRuntimeState.activeAccountBootstrap = nextAccount
  webRuntimeState.activeCloudBootstrap = cloudBootstrap ?? null
  webRuntimeState.activeEnvironment = nextAccount
    ? accountRuntimeEnvironment(nextAccount.runtime)
    : cloudBootstrap
      ? createVolatileCloudEnvironment(cloudBootstrap)
      : readStoredWebRuntimeEnvironment()
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

export function manuallyDisconnectedResponse(
  environment: StoredWebRuntimeEnvironment
): RuntimeRpcResponse<never> {
  return {
    id: 'runtime.manualDisconnect',
    ok: false,
    error: {
      code: 'runtime_manually_disconnected',
      message: translate(
        'auto.web.webPreloadApi.runtimeEnvironmentManuallyDisconnected',
        'Runtime environment is manually disconnected.'
      )
    },
    _meta: { runtimeId: environment.runtimeId }
  }
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
  if (webRuntimeState.activeEnvironment?.id !== environment.id) {
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
    webRuntimeState.activeEnvironment = {
      ...environment,
      runtimeId,
      updatedAt: Date.now(),
      lastUsedAt: Date.now()
    }
    return
  }
  webRuntimeState.activeEnvironment = updateStoredEnvironmentRuntimeId(
    environment,
    runtimeId,
    pairedDeviceId
  )
}

function cloudEnvironmentId(bootstrap: CloudLaunchBootstrap): string {
  return `cloud-${bootstrap.managedWebSessionId}`
}

function createVolatileCloudEnvironment(
  bootstrap: CloudLaunchBootstrap
): StoredWebRuntimeEnvironment {
  const now = Date.now()
  const id = cloudEnvironmentId(bootstrap)
  return {
    id,
    name: 'Hive Runtime',
    createdAt: now,
    updatedAt: now,
    lastUsedAt: null,
    runtimeId: null,
    preferredEndpointId: `wss-${id}`,
    endpoints: [
      {
        id: `wss-${id}`,
        kind: 'websocket',
        label: translate('web.runtime.cloudWebSocket', 'Cloud WSS'),
        endpoint: bootstrap.websocketUrl,
        deviceToken: '',
        publicKeyB64: bootstrap.serverPublicKeyB64
      }
    ]
  }
}
