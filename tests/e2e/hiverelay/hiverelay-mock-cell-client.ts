import type { IncomingMessage } from 'node:http'
import type { WebSocket } from 'ws'
import {
  ClientAdmissionSchema,
  deriveHiveRelayKeyHash,
  fromBase64Url,
  parseStrictJson,
  type ClientAdmission,
  type HostHello
} from './hiverelay-test-wire'
import { wireText } from './hiverelay-websocket-peer'
import {
  MOCK_CELL_AUTH_TIMEOUT_CLOSE,
  MOCK_CELL_CAPACITY_CLOSE,
  MOCK_CELL_DRAINING_CLOSE,
  MOCK_CELL_ORIGIN_CLOSE,
  MOCK_CELL_POLICY_CLOSE,
  MOCK_CELL_REPLAY_CLOSE,
  MOCK_CELL_STALE_BINDING_CLOSE,
  closeMockCellSocket,
  digestMockCellCredential,
  sameMockCellBinding,
  type AdmissionRecord,
  type CellConnection,
  type ProgrammableMockCellOptions
} from './hiverelay-mock-cell-state'
type AcceptMockCellClientArgs = {
  socket: WebSocket
  request: IncomingMessage
  routeHostId: string
  options: ProgrammableMockCellOptions
  draining: boolean
  currentIncarnationId: string
  hostHello: HostHello | null
  admissions: Map<string, AdmissionRecord>
  connections: Map<string, CellConnection>
  preAuthClients: Set<WebSocket>
  reserveClient: (socket: WebSocket, grant: AdmissionRecord) => void
}

export function acceptMockCellClient(args: AcceptMockCellClientArgs): void {
  const maximumPreAuth = args.options.maxPreAuthConnections ?? 128
  if (args.preAuthClients.size >= maximumPreAuth) {
    closeMockCellSocket(args.socket, MOCK_CELL_CAPACITY_CLOSE, 'CAPACITY_EXCEEDED')
    return
  }
  args.preAuthClients.add(args.socket)
  const preAuthTimeout = setTimeout(() => {
    args.preAuthClients.delete(args.socket)
    closeMockCellSocket(args.socket, MOCK_CELL_AUTH_TIMEOUT_CLOSE, 'AUTH_TIMEOUT')
  }, args.options.preAuthTimeoutMs ?? 5_000)
  preAuthTimeout.unref()
  const leavePreAuth = (): void => {
    clearTimeout(preAuthTimeout)
    args.preAuthClients.delete(args.socket)
  }
  args.socket.once('close', leavePreAuth)
  args.socket.once('message', (raw, isBinary) => {
    leavePreAuth()
    if (isBinary) {
      closeMockCellSocket(args.socket, MOCK_CELL_POLICY_CLOSE, 'INVALID_CLIENT_ADMISSION')
      return
    }
    let admission: ClientAdmission
    try {
      admission = parseStrictJson(wireText(raw), ClientAdmissionSchema)
    } catch {
      closeMockCellSocket(args.socket, MOCK_CELL_POLICY_CLOSE, 'INVALID_CLIENT_ADMISSION')
      return
    }
    const grant = args.admissions.get(digestMockCellCredential(admission.clientAdmissionToken))
    const clientKey = fromBase64Url(admission.clientPublicKeyB64, 32)
    const origin =
      typeof args.request.headers.origin === 'string' ? args.request.headers.origin : null
    if (args.draining) {
      closeMockCellSocket(args.socket, MOCK_CELL_DRAINING_CLOSE, 'DRAINING')
    } else if (!grant || grant.state !== 'UNUSED') {
      closeMockCellSocket(
        args.socket,
        grant?.state === 'CONSUMED' ? MOCK_CELL_REPLAY_CLOSE : MOCK_CELL_POLICY_CLOSE,
        grant?.state === 'CONSUMED' ? 'REPLAY_DETECTED' : 'INVALID_ADMISSION'
      )
    } else if (origin !== grant.origin) {
      closeMockCellSocket(args.socket, MOCK_CELL_ORIGIN_CLOSE, 'ORIGIN_REJECTED')
    } else if ((args.options.now ?? Date.now)() > grant.expiresAtMs) {
      closeMockCellSocket(args.socket, MOCK_CELL_POLICY_CLOSE, 'ADMISSION_EXPIRED')
    } else if (args.connections.size >= (args.options.maxConnections ?? 64)) {
      closeMockCellSocket(args.socket, MOCK_CELL_CAPACITY_CLOSE, 'CAPACITY_EXCEEDED')
    } else if (
      args.routeHostId !== grant.binding.relayHostId ||
      !clientKey ||
      grant.clientPublicKeyB64 !== admission.clientPublicKeyB64 ||
      grant.clientKeyHash !== deriveHiveRelayKeyHash(clientKey) ||
      !args.hostHello ||
      !sameMockCellBinding(grant.binding, args.hostHello) ||
      grant.binding.cellIncarnationId !== args.currentIncarnationId
    ) {
      closeMockCellSocket(args.socket, MOCK_CELL_STALE_BINDING_CLOSE, 'STALE_BINDING')
    } else {
      args.reserveClient(args.socket, grant)
    }
  })
}
