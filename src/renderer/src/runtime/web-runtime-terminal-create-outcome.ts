import { translate } from '../i18n/i18n'
import type { CreatedWebRuntimeSessionTerminal } from './web-runtime-session-types'

export function reportWebRuntimeTerminalCreateFailure(
  error: unknown,
  hostCreated: boolean,
  createdTabId: string | undefined
): CreatedWebRuntimeSessionTerminal {
  const message = error instanceof Error ? error.message : String(error)
  console.warn(
    hostCreated
      ? '[web-runtime-session] terminal created but reconciliation failed:'
      : '[web-runtime-session] failed to create terminal:',
    message
  )
  return {
    outcome: hostCreated ? { status: 'created' } : { status: 'failed', message },
    ...(createdTabId ? { hostTabId: createdTabId } : {})
  }
}

export function disconnectedWebRuntimeTerminalCreateOutcome(): CreatedWebRuntimeSessionTerminal {
  return {
    outcome: {
      status: 'failed',
      message: translate(
        'auto.runtime.webRuntimeSession.remoteHostDisconnected',
        'The workspace is not connected to a remote Orca host.'
      )
    }
  }
}
