import type { RuntimeCapability } from '../../../shared/protocol-version'
import type { TerminalStreamFrame } from '../../../shared/terminal-stream-protocol'

export type RpcDispatchStreamingOptions = {
  authorizeRequest?: (method: string) => boolean
  authenticatedCallerFingerprint?: string
  connectionId?: string
  signal?: AbortSignal
  clientId?: string
  pairedDeviceId?: string
  authenticatedAccountRuntimeSessionId?: string
  authenticatedAccountOperationCallerKey?: string
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
