import type { WebSocket } from 'ws'
import type { E2EEChannel } from './e2ee-channel'
import type {
  AuthenticatedMobileSocket,
  AuthenticatedCloudManagedSocket,
  MobileSocketWiringOptions
} from './mobile-socket-wiring-types'
type MobileSocketCloseOwner = {
  authenticatedSockets: Map<WebSocket, AuthenticatedMobileSocket>
  authenticatedCloudSockets: Map<WebSocket, AuthenticatedCloudManagedSocket>
  channels: Map<WebSocket, E2EEChannel>
  connectionIds: Map<WebSocket, string>
  onClose: MobileSocketWiringOptions['onClose']
  onCloudClose: MobileSocketWiringOptions['onCloudClose']
}
export function closeMobileSocket(ws: WebSocket, owner: MobileSocketCloseOwner): void {
  if (!owner.connectionIds.has(ws)) {
    return
  }
  const socket = owner.authenticatedSockets.get(ws) ?? null
  const cloudSocket = owner.authenticatedCloudSockets.get(ws) ?? null
  owner.authenticatedSockets.delete(ws)
  owner.authenticatedCloudSockets.delete(ws)
  owner.channels.get(ws)?.destroy()
  owner.channels.delete(ws)
  owner.connectionIds.delete(ws)
  const hasOtherConnections =
    socket !== null &&
    Array.from(owner.authenticatedSockets.values()).some(
      (candidate) => candidate.device.deviceId === socket.device.deviceId
    )
  owner.onClose(socket, hasOtherConnections)
  if (cloudSocket) {
    const hasOtherCloudConnections = Array.from(owner.authenticatedCloudSockets.values()).some(
      (candidate) =>
        candidate.principal.managedWebSessionId === cloudSocket.principal.managedWebSessionId
    )
    owner.onCloudClose?.(cloudSocket, hasOtherCloudConnections)
  }
}
