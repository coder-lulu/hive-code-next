import type { ConnectionState, HostCatalogEntry } from '../transport/types'

export type MobileTaskRuntimeState =
  | 'ready'
  | 'unsupported'
  | 'loading'
  | 'offline'
  | 'auth-failed'
  | 'disconnected'
  | 'unavailable'

export function resolveMobileTaskRuntimeState(input: {
  readonly connectionState: ConnectionState
  readonly tasksSupported: boolean
  readonly tasksUnsupported: boolean
  readonly accountPresence?: HostCatalogEntry['accountPresence']
  readonly credentialStatus?: HostCatalogEntry['credentialStatus']
  readonly catalogLoading?: boolean
}): MobileTaskRuntimeState {
  if (input.connectionState === 'connected' && input.tasksSupported) {
    return 'ready'
  }
  if (input.connectionState === 'connected' && input.tasksUnsupported) {
    return 'unsupported'
  }
  if (input.connectionState === 'auth-failed') {
    return 'auth-failed'
  }
  if (input.connectionState === 'disconnected') {
    if (input.credentialStatus === 'missing') {
      return 'auth-failed'
    }
    if (input.accountPresence === 'OFFLINE' || input.credentialStatus === 'cloud-offline') {
      return 'offline'
    }
    if (
      input.credentialStatus === 'cloud-unavailable' ||
      input.credentialStatus === 'temporarily-unavailable'
    ) {
      return 'unavailable'
    }
    return input.catalogLoading ? 'loading' : 'disconnected'
  }
  return 'loading'
}
