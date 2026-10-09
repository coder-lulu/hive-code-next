import type { RuntimeCapability } from '../../../shared/protocol-version'
import type { TerminalStreamFrame } from '../../../shared/terminal-stream-protocol'
import type { RpcCallerIdentity } from './rpc-caller-identity'

export type RpcDispatchStreamingOptions = {
  authorizeRequest?: (method: string) => boolean
  authenticatedCallerFingerprint?: string
  connectionId?: string
  signal?: AbortSignal
  clientId?: string
  pairedDeviceId?: string
  authenticatedAccountRuntimeSessionId?: string
  authenticatedAccountOperationCallerKey?: string
  /** Set by a transport that knows its caller but carries no paired device (the desktop's IPC). */
  caller?: RpcCallerIdentity
  clientKind?: 'mobile' | 'runtime'
  clientCapabilities?: readonly RuntimeCapability[]
  updateClientCapabilities?: (capabilities: readonly RuntimeCapability[]) => void
  sendBinary?: (bytes: Uint8Array<ArrayBufferLike>) => boolean | void
  registerBinaryStreamHandler?: (
    streamId: number,
    handler: (frame: TerminalStreamFrame) => void
  ) => () => void
  registerBinaryMessageHandler?: (
    handler: (bytes: Uint8Array<ArrayBufferLike>) => void
  ) => () => void
}
