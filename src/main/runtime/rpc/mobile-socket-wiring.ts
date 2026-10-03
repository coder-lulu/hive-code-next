import { randomBytes } from 'node:crypto'
import type { WebSocket } from 'ws'
import type { DeviceEntry, DeviceRegistry } from '../device-registry'
import type { E2EEKeypair } from '../e2ee-keypair'
import {
  E2EEChannel,
  type E2EEAuthenticatedCloudSession,
  type E2EEAuthenticatedDevice
} from './e2ee-channel'
import { createMobileE2EEOutboundMemoryBudget } from './mobile-e2ee-outbound-memory-budget'
import type { RuntimeCapability } from '../../../shared/protocol-version'
import type { CloudManagedE2EEAuth } from './cloud-managed-e2ee-auth-validation'
import type { WebSocketConnectionRequest } from './ws-transport'

type MobileSocketPayload = string | Uint8Array<ArrayBufferLike>

export type MobileSocketTransportMetadata =
  | { transport: 'direct'; request?: WebSocketConnectionRequest }
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

type MobileSocketWiringOptions = {
  deviceRegistry: DeviceRegistry
  e2eeKeypair: E2EEKeypair
  onText: (
    socket: AuthenticatedMobileSocket,
    plaintext: string,
    reply: (response: string) => void,
    sendBinary: (response: Uint8Array<ArrayBufferLike>) => boolean | void
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
    sendBinary: (response: Uint8Array<ArrayBufferLike>) => boolean | void
  ) => void
  onCloudBinary?: (
    socket: AuthenticatedCloudManagedSocket,
    bytes: Uint8Array<ArrayBufferLike>
  ) => void
  onCloudClose?: (socket: AuthenticatedCloudManagedSocket, hasOtherConnections: boolean) => void
  onCloudReady?: (socket: AuthenticatedCloudManagedSocket) => void
  // Why: stale keys and missing registry entries both fail before RPC can explain the re-pair action.
  onUnpairedDeviceAuthFailure?: (metadata: MobileSocketTransportMetadata) => void
}

function toAuthenticatedDevice(device: DeviceEntry): E2EEAuthenticatedDevice {
  return {
    deviceId: device.deviceId,
    deviceToken: device.token,
    scope: device.scope
  }
}

export class MobileSocketWiring {
  private readonly deviceRegistry: DeviceRegistry
  private readonly e2eeKeypair: E2EEKeypair
  private readonly onText: MobileSocketWiringOptions['onText']
  private readonly onBinary: MobileSocketWiringOptions['onBinary']
  private readonly onClose: MobileSocketWiringOptions['onClose']
  private readonly onReady: MobileSocketWiringOptions['onReady']
  private readonly onUnpairedDeviceAuthFailure: MobileSocketWiringOptions['onUnpairedDeviceAuthFailure']
  private readonly resolveCloudManagedSession: MobileSocketWiringOptions['resolveCloudManagedSession']
  private readonly onCloudText: MobileSocketWiringOptions['onCloudText']
  private readonly onCloudBinary: MobileSocketWiringOptions['onCloudBinary']
  private readonly onCloudClose: MobileSocketWiringOptions['onCloudClose']
  private readonly onCloudReady: MobileSocketWiringOptions['onCloudReady']
  private readonly channels = new Map<WebSocket, E2EEChannel>()
  private readonly connectionIds = new Map<WebSocket, string>()
  private readonly authenticatedSockets = new Map<WebSocket, AuthenticatedMobileSocket>()
  private readonly authenticatedCloudSockets = new Map<WebSocket, AuthenticatedCloudManagedSocket>()
  private readonly transports = new Set<MobileSocketTransport>()
  private readonly outboundMemoryBudget = createMobileE2EEOutboundMemoryBudget()

  constructor(options: MobileSocketWiringOptions) {
    this.deviceRegistry = options.deviceRegistry
    this.e2eeKeypair = options.e2eeKeypair
    this.onText = options.onText
    this.onBinary = options.onBinary
    this.onClose = options.onClose
    this.onReady = options.onReady
    this.onUnpairedDeviceAuthFailure = options.onUnpairedDeviceAuthFailure
    this.resolveCloudManagedSession = options.resolveCloudManagedSession
    this.onCloudText = options.onCloudText
    this.onCloudBinary = options.onCloudBinary
    this.onCloudClose = options.onCloudClose
    this.onCloudReady = options.onCloudReady
  }

  attachTransport(
    transport: MobileSocketTransport,
    getMetadata: (ws: WebSocket) => MobileSocketTransportMetadata = () => ({
      transport: 'direct'
    })
  ): () => void {
    this.transports.add(transport)
    transport.onMessage((message, _reply, ws) => {
      this.handleRawMessage(transport, ws, message, getMetadata(ws))
    })
    transport.onConnectionClose((_clientId, ws) => this.handleClose(ws))
    let attached = true
    return () => {
      if (!attached) {
        return
      }
      attached = false
      this.transports.delete(transport)
    }
  }

  getConnectionId(ws: WebSocket): string | undefined {
    return this.connectionIds.get(ws)
  }

  get channelCount(): number {
    return this.channels.size
  }

  get connectionCount(): number {
    return this.connectionIds.size
  }

  terminateDeviceConnections(deviceToken: string): number {
    let terminated = 0
    for (const transport of this.transports) {
      terminated += transport.terminateClientConnections(deviceToken)
    }
    return terminated
  }

  terminateCloudSessionConnections(managedWebSessionId: string): number {
    let terminated = 0
    for (const transport of this.transports) {
      terminated += transport.terminateClientConnections(cloudSessionClientId(managedWebSessionId))
    }
    return terminated
  }

  private handleRawMessage(
    transport: MobileSocketTransport,
    ws: WebSocket,
    message: MobileSocketPayload,
    metadata: MobileSocketTransportMetadata
  ): void {
    let channel = this.channels.get(ws)
    if (!channel) {
      const connectionId = randomBytes(8).toString('hex')
      this.connectionIds.set(ws, connectionId)
      channel = new E2EEChannel(ws, {
        serverSecretKey: this.e2eeKeypair.secretKey,
        transportContext:
          metadata.transport === 'relay'
            ? { transport: 'relay', relayHostId: metadata.relayHostId }
            : { transport: 'direct' },
        outboundMemoryBudget: this.outboundMemoryBudget,
        resolveAuthenticatedDevice: (token) => {
          const device = this.deviceRegistry.validateToken(token)
          if (!device) {
            return null
          }
          // Why: outer relay authorization cannot choose the local Orca
          // identity; E2EE must resolve the same device before readiness.
          if (metadata.transport === 'relay' && metadata.relayDeviceId !== device.deviceId) {
            return null
          }
          return toAuthenticatedDevice(device)
        },
        ...(this.resolveCloudManagedSession && metadata.transport === 'direct'
          ? {
              resolveCloudManagedSession: (auth: CloudManagedE2EEAuth) =>
                this.resolveCloudManagedSession?.(auth, metadata) ?? null,
              onCloudReady: (channel: E2EEChannel, principal: E2EEAuthenticatedCloudSession) => {
                const socket = {
                  ws,
                  connectionId,
                  principal,
                  clientCapabilities: channel.clientCapabilities,
                  transport: metadata
                }
                this.authenticatedCloudSockets.set(ws, socket)
                transport.setClientId(ws, cloudSessionClientId(principal.managedWebSessionId))
                this.onCloudReady?.(socket)
              }
            }
          : {}),
        onReady: (channel, device) => {
          const socket = {
            ws,
            connectionId,
            device,
            // Why: the channel owns the set for the whole connection, so this reads
            // through rather than snapshotting. It must also WRITE through — the
            // capability RPC updates the socket, and a getter-only property makes
            // that a TypeError, which strands a capable phone with no capabilities.
            get clientCapabilities() {
              return channel.clientCapabilities
            },
            set clientCapabilities(next: readonly RuntimeCapability[]) {
              channel.clientCapabilities = next
            },
            transport: metadata
          }
          this.authenticatedSockets.set(ws, socket)
          transport.setClientId(ws, device.deviceToken)
          // Why: deferred — the client's e2ee_authenticated must not wait on a secure-file rewrite.
          this.deviceRegistry.updateLastSeenDeferred(device.deviceId)
          this.onReady?.(socket)
        },
        onError: (code, reason, principalKind) => {
          const reportUnpairedDevice =
            code === 4001 &&
            reason === 'Unauthorized' &&
            principalKind !== 'cloud_managed_web_session'
          this.channels.get(ws)?.destroy()
          this.channels.delete(ws)
          ws.close(code, reason)
          if (reportUnpairedDevice) {
            try {
              this.onUnpairedDeviceAuthFailure?.(metadata)
            } catch (error) {
              // Why: renderer teardown can make UI delivery throw; auth cleanup must remain authoritative.
              console.error('[mobile] Failed to report unpaired-device auth failure:', error)
            }
          }
        }
      })
      channel.onMessage((plaintext, reply, sendBinary) => {
        const socket = this.authenticatedSockets.get(ws)
        if (socket) {
          this.onText(socket, plaintext, reply, sendBinary)
          return
        }
        const cloudSocket = this.authenticatedCloudSockets.get(ws)
        if (cloudSocket) {
          this.onCloudText?.(cloudSocket, plaintext, reply, sendBinary)
        }
      })
      channel.onBinaryMessage((bytes) => {
        const socket = this.authenticatedSockets.get(ws)
        if (socket) {
          this.onBinary(socket, bytes)
          return
        }
        const cloudSocket = this.authenticatedCloudSockets.get(ws)
        if (cloudSocket) {
          this.onCloudBinary?.(cloudSocket, bytes)
        }
      })
      this.channels.set(ws, channel)
    }
    channel.handleRawMessage(message)
  }

  private handleClose(ws: WebSocket): void {
    const socket = this.authenticatedSockets.get(ws) ?? null
    const cloudSocket = this.authenticatedCloudSockets.get(ws) ?? null
    this.authenticatedSockets.delete(ws)
    this.authenticatedCloudSockets.delete(ws)
    this.channels.get(ws)?.destroy()
    this.channels.delete(ws)
    this.connectionIds.delete(ws)
    const hasOtherConnections =
      socket !== null &&
      Array.from(this.authenticatedSockets.values()).some(
        (candidate) => candidate.device.deviceToken === socket.device.deviceToken
      )
    this.onClose(socket, hasOtherConnections)
    if (cloudSocket) {
      const hasOtherCloudConnections = Array.from(this.authenticatedCloudSockets.values()).some(
        (candidate) =>
          candidate.principal.managedWebSessionId === cloudSocket.principal.managedWebSessionId
      )
      this.onCloudClose?.(cloudSocket, hasOtherCloudConnections)
    }
  }
}

function cloudSessionClientId(managedWebSessionId: string): string {
  return `cloud-managed:${managedWebSessionId}`
}
