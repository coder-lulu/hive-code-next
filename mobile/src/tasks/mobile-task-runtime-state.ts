import type { ConnectionState } from '../transport/types'

export type MobileTaskRuntimeState = 'ready' | 'unsupported' | 'loading' | 'offline' | 'auth-failed'

export function resolveMobileTaskRuntimeState(input: {
  readonly connectionState: ConnectionState
  readonly tasksSupported: boolean
  readonly tasksUnsupported: boolean
}): MobileTaskRuntimeState {
  if (input.tasksSupported) {
    return 'ready'
  }
  if (input.tasksUnsupported) {
    return 'unsupported'
  }
  if (input.connectionState === 'auth-failed') {
    return 'auth-failed'
  }
  if (input.connectionState === 'disconnected') {
    return 'offline'
  }
  return 'loading'
}
