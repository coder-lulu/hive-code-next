import type { CloudManagedE2EEAuth } from './cloud-managed-e2ee-auth-validation'
import { randomBytes } from 'node:crypto'
import type { WebSocket } from 'ws'
import type { DeviceEntry, DeviceRegistry } from '../device-registry'
import { isPendingTokenRow } from '../device-entry'
import {
  INSECURE_WEB_ORIGIN_AUTH_CODE,
  isInsecureRemoteWebOrigin
} from '../../../shared/web-origin-security'
import { devicePrincipalOf } from '../device-principal'
import type { E2EEKeypair } from '../e2ee-keypair'
import {
  E2EEChannel,
  type E2EEAuthenticatedCloudSession,
  type E2EEAuthenticatedDevice
} from './e2ee-channel'
import { createMobileE2EEOutboundMemoryBudget } from './mobile-e2ee-outbound-memory-budget'
import type { RuntimeCapability } from '../../../shared/protocol-version'

import type {
  MobileSocketWiringOptions,
  MobileSocketPayload,
  MobileSocketTransportMetadata,
  MobileSocketTransport,
  AuthenticatedMobileSocket,
  AuthenticatedCloudManagedSocket
} from './mobile-socket-wiring-types'
export type {
  MobileSocketTransportMetadata,
  MobileSocketTransport,
  AuthenticatedMobileSocket,
  AuthenticatedCloudManagedSocket
} from './mobile-socket-wiring-types'

function toAuthenticatedDevice(device: DeviceEntry): E2EEAuthenticatedDevice {
  return {
    ...devicePrincipalOf(device),
    deviceToken: device.token
  }
}

export class MobileSocketWiring {
  private disposed = false
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
  private readonly allowInsecureWebPairing: () => boolean
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
    this.allowInsecureWebPairing = options.allowInsecureWebPairing ?? (() => false)
  }

  attachTransport(
    transport: MobileSocketTransport,
    getMetadata: (ws: WebSocket) => MobileSocketTransportMetadata = () => ({
      transport: 'direct'
    })
  ): () => void {
    if (this.disposed) {
      throw new Error('mobile_socket_wiring_disposed')
    }
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

  terminateDeviceConnections(deviceId: string): number {
    let terminated = 0
    for (const transport of this.transports) {
      terminated += transport.terminateClientConnections(deviceId)
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
    if (this.disposed) {
      return
    }
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
          if (
            isPendingTokenRow(device) &&
            metadata.transport === 'direct' &&
            // Why the marker too: phones send an http Origin as well, and must never be gated.
            metadata.webClient === true &&
            isInsecureRemoteWebOrigin(metadata.webOrigin) &&
            !this.allowInsecureWebPairing()
          ) {
            return { refused: INSECURE_WEB_ORIGIN_AUTH_CODE }
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
            transcriptHashB64: channel.transcriptHashB64,
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
          transport.setClientId(ws, device.deviceId)
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

  dispose(): void {
    if (this.disposed) {
      return
    }
    this.disposed = true
    this.transports.clear()
    for (const ws of this.connectionIds.keys()) {
      try {
        this.handleClose(ws)
      } catch (error) {
        console.error('[mobile] Failed to notify socket disposal:', error)
      }
    }
  }

  private handleClose(ws: WebSocket): void {
    if (!this.connectionIds.has(ws)) {
      return
    }
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
        (candidate) => candidate.device.deviceId === socket.device.deviceId
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
