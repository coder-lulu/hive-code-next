import type { WorkspaceCreatorProvenance } from '../../../shared/worktree/types'
import type { RpcContext } from './core'

export function resolveRpcWorkspaceCreatorProvenance(
  context: Pick<
    RpcContext,
    | 'pairedDeviceId'
    | 'authenticatedAccountRuntimeSessionId'
    | 'clientId'
    | 'clientKind'
    | 'connectionId'
  >
): WorkspaceCreatorProvenance {
  if (context.authenticatedAccountRuntimeSessionId?.trim()) {
    return {
      kind: 'account-runtime',
      runtimeSessionId: context.authenticatedAccountRuntimeSessionId
    }
  }
  if (context.pairedDeviceId) {
    return { kind: 'paired-device', deviceId: context.pairedDeviceId }
  }
  if (context.clientId || context.clientKind || context.connectionId) {
    throw new Error('authenticated_device_identity_missing')
  }
  return { kind: 'host' }
}
