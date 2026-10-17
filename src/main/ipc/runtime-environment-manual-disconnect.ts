const manuallyDisconnectedEnvironmentIds = new Set<string>()

export const RUNTIME_MANUALLY_DISCONNECTED_MESSAGE = 'Runtime environment is manually disconnected.'

export function markRuntimeEnvironmentManuallyDisconnected(environmentId: string): void {
  manuallyDisconnectedEnvironmentIds.add(environmentId)
}

export function clearRuntimeEnvironmentManualDisconnect(environmentId: string): void {
  manuallyDisconnectedEnvironmentIds.delete(environmentId)
}

export function isRuntimeEnvironmentManuallyDisconnected(environmentId: string): boolean {
  return manuallyDisconnectedEnvironmentIds.has(environmentId)
}
import type { PublicKnownRuntimeEnvironment } from '../../shared/runtime-environments'
import type { RuntimeRpcResponse } from '../../shared/runtime-rpc-envelope'

export function manuallyDisconnectedResponse(
  environment: Pick<PublicKnownRuntimeEnvironment, 'id' | 'runtimeId' | 'runtimeRecordId'>
): RuntimeRpcResponse<never> {
  return {
    id: 'runtime.manualDisconnect',
    ok: false,
    error: {
      code: 'runtime_manually_disconnected',
      message: RUNTIME_MANUALLY_DISCONNECTED_MESSAGE
    },
    _meta: { runtimeId: environment.runtimeId ?? environment.runtimeRecordId ?? environment.id }
  }
}
