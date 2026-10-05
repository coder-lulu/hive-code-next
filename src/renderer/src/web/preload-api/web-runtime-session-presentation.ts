import type { RuntimeRpcResponse } from '../../../../shared/runtime-rpc-envelope'
import { resolveHiveRuntimeDisplayName } from '../../../../shared/hive-runtime-display-name'
import { translate } from '@/i18n/i18n'
import type { CloudLaunchBootstrap } from '../cloud-launch-bootstrap'
import type { StoredWebRuntimeEnvironment } from '../web-runtime-environment'

export function cloudEnvironmentId(bootstrap: CloudLaunchBootstrap): string {
  return `cloud-${bootstrap.managedWebSessionId}`
}

export function createVolatileCloudEnvironment(
  bootstrap: CloudLaunchBootstrap
): StoredWebRuntimeEnvironment {
  const now = Date.now()
  const id = cloudEnvironmentId(bootstrap)
  return {
    id,
    name: resolveHiveRuntimeDisplayName({
      ...bootstrap.runtimeDisplayMetadata,
      reportedDeviceName: bootstrap.runtimeDisplayMetadata.deviceName
    }),
    runtimeRecordId: bootstrap.runtimeDisplayMetadata.runtimeRecordId,
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
