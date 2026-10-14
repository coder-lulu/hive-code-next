import type { DeviceRegistry } from '../device-registry'
import type { E2EEKeypair } from '../e2ee-keypair'
import type { CloudManagedE2EEAuth } from './cloud-managed-e2ee-auth-validation'
import type { RpcBinarySender } from './rpc-binary-sender'
import type { WebSocket } from 'ws'
import type { RuntimeCapability } from '../../../shared/protocol-version'
import type { WebSocketConnectionRequest } from './ws-transport'
import type { E2EEAuthenticatedCloudSession, E2EEAuthenticatedDevice } from './e2ee-channel'

export type MobileSocketPayload = string | Uint8Array<ArrayBufferLike>

export type MobileSocketTransportMetadata =
  | { transport: 'direct'; request?: WebSocketConnectionRequest; webOrigin?: string; webClient?: true }
  | {
      transport: 'relay'
      relayHostId: string
      relayDeviceId: string
      basisConnId: string
      credentialKind: 'invite' | 'resume'
    }

export type MobileSocketTransport = {
  onMessage(
    handler: (
      message: MobileSocketPayload,
      reply: (response: string) => void,
      ws: WebSocket
    ) => void
  ): void
  onConnectionClose(
    handler: (clientId: string | null, ws: WebSocket, hasOtherConnections: boolean) => void
  ): void
  setClientId(ws: WebSocket, clientId: string): void
  terminateClientConnections(clientId: string): number
}

export type AuthenticatedMobileSocket = {
  ws: WebSocket
  connectionId: string
  device: E2EEAuthenticatedDevice
  // The current v2 transcript binds the authenticated transport.
  transcriptHashB64: string | null
  clientCapabilities: readonly RuntimeCapability[]
  transport: MobileSocketTransportMetadata
}

export type AuthenticatedCloudManagedSocket = {
  ws: WebSocket
  connectionId: string
  principal: E2EEAuthenticatedCloudSession
  clientCapabilities: readonly RuntimeCapability[]
  transport: Extract<MobileSocketTransportMetadata, { transport: 'direct' }>
}


export type MobileSocketWiringOptions = {
  deviceRegistry: DeviceRegistry
  e2eeKeypair: E2EEKeypair
  onText: (
    socket: AuthenticatedMobileSocket,
    plaintext: string,
    reply: (response: string) => void,
    sendBinary: RpcBinarySender
  ) => void
  onBinary: (socket: AuthenticatedMobileSocket, bytes: Uint8Array<ArrayBufferLike>) => void
  onClose: (socket: AuthenticatedMobileSocket | null, hasOtherConnections: boolean) => void
  onReady?: (socket: AuthenticatedMobileSocket) => void
  resolveCloudManagedSession?: (
    auth: CloudManagedE2EEAuth,
    metadata: MobileSocketTransportMetadata
  ) => E2EEAuthenticatedCloudSession | null
  onCloudText?: (
    socket: AuthenticatedCloudManagedSocket,
    plaintext: string,
    reply: (response: string) => void,
    sendBinary: RpcBinarySender
  ) => void
  onCloudBinary?: (
    socket: AuthenticatedCloudManagedSocket,
    bytes: Uint8Array<ArrayBufferLike>
  ) => void
  onCloudClose?: (socket: AuthenticatedCloudManagedSocket, hasOtherConnections: boolean) => void
  onCloudReady?: (socket: AuthenticatedCloudManagedSocket) => void
  // Why: stale keys and missing registry entries both fail before RPC can explain the re-pair action.
  onUnpairedDeviceAuthFailure?: (metadata: MobileSocketTransportMetadata) => void
  // Operator opt-in for first pairings from a plain-http page on another machine.
  allowInsecureWebPairing?: () => boolean
}
