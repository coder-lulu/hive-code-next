import { createHash, randomBytes } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import type { RawData, WebSocket } from 'ws'
import {
  HiveRelayBindingSchema,
  encodeWireJson,
  toBase64Url,
  type ConnectionOpen,
  type HiveRelayBinding
} from './hiverelay-test-wire'

export const MOCK_CELL_POLICY_CLOSE = 1008
export const MOCK_CELL_AUTH_TIMEOUT_CLOSE = 4408
export const MOCK_CELL_REPLAY_CLOSE = 4409
export const MOCK_CELL_STALE_BINDING_CLOSE = 4410
export const MOCK_CELL_HOST_UNAVAILABLE_CLOSE = 4411
export const MOCK_CELL_DRAINING_CLOSE = 4413
export const MOCK_CELL_CAPACITY_CLOSE = 1013
export const MOCK_CELL_ORIGIN_CLOSE = 4403

export type MockAdmissionGrant = {
  token: string
  binding: HiveRelayBinding
  origin: string | null
  expiresAtMs: number
  clientPublicKeyB64: string
  intentId: string
  clientKeyHash: string
}

export type MockCellEvent = {
  kind:
    | 'host-active'
    | 'client-reserved'
    | 'connection-open-sent'
    | 'connection-active'
    | 'ciphertext-forwarded'
    | 'connection-released'
    | 'drain-started'
    | 'incarnation-rotated'
  connId?: string
  direction?: 'client-to-host' | 'host-to-client'
  byteLength?: number
  reason?: string
}

export type ProgrammableMockCellOptions = {
  cellOrigin: string
  controlLease: string
  binding: HiveRelayBinding
  admissionGrants: readonly MockAdmissionGrant[]
  now?: () => number
  random?: (size: number) => Uint8Array
  attachTimeoutMs?: number
  holdConnectionOpens?: boolean
  eventCapacity?: number
  maxConnections?: number
  preAuthTimeoutMs?: number
  maxPreAuthConnections?: number
  relayHelloBindingOverride?: {
    cellId: string
    cellIncarnationId: string
  }
}

export type AdmissionRecord = Omit<MockAdmissionGrant, 'token'> & {
  state: 'UNUSED' | 'RESERVED' | 'CONSUMED'
}

export type CellConnection = {
  connId: string
  connTicketSha256: Buffer
  grant: AdmissionRecord
  client: WebSocket
  hostData: WebSocket | null
  deadlineMs: number
  state: 'WAIT_HOST_ATTACH' | 'ACTIVE' | 'CLOSED'
}

export class MockCellEventLog {
  private readonly values: (MockCellEvent | undefined)[]
  private start = 0
  private size = 0

  constructor(private readonly capacity: number) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) {
      throw new Error('Mock Cell event capacity must be a positive safe integer')
    }
    this.values = Array.from<MockCellEvent | undefined>({ length: capacity })
  }

  push(event: MockCellEvent): void {
    if (this.size < this.capacity) {
      this.values[(this.start + this.size) % this.capacity] = event
      this.size += 1
      return
    }
    this.values[this.start] = event
    this.start = (this.start + 1) % this.capacity
  }

  snapshot(): MockCellEvent[] {
    return Array.from(
      { length: this.size },
      (_, index) => this.values[(this.start + index) % this.capacity] as MockCellEvent
    )
  }
}

export function digestMockCellTicket(ticket: string): Buffer {
  return createHash('sha256').update(ticket, 'utf8').digest()
}

export function digestMockCellCredential(credential: string): string {
  return createHash('sha256').update(credential, 'utf8').digest('hex')
}

export function createMockCellConnectionId(
  sequence: number,
  random: (size: number) => Uint8Array = (size) => randomBytes(size)
): string {
  return `conn-${toBase64Url(random(16))}-${sequence}`
}

export function sameMockCellBinding(left: HiveRelayBinding, right: HiveRelayBinding): boolean {
  return Object.keys(HiveRelayBindingSchema.shape).every(
    (key) => left[key as keyof HiveRelayBinding] === right[key as keyof HiveRelayBinding]
  )
}

export function sendMockCellJson(socket: WebSocket, message: Record<string, unknown>): void {
  if (socket.readyState === socket.OPEN) {
    socket.send(encodeWireJson(message))
  }
}

export function closeMockCellSocket(socket: WebSocket, code: number, reason: string): void {
  if (socket.readyState === socket.OPEN || socket.readyState === socket.CONNECTING) {
    socket.close(code, reason)
  }
}

export function readMockCellBearer(request: IncomingMessage): string | null {
  const value = request.headers.authorization
  return typeof value === 'string' && value.startsWith('Bearer ') ? value.slice(7) : null
}

export function forwardMockCellCiphertext(args: {
  connection: CellConnection
  direction: 'client-to-host' | 'host-to-client'
  destination: WebSocket
  raw: RawData
  isBinary: boolean
  recordEvent: (event: MockCellEvent) => void
}): void {
  if (args.connection.state !== 'ACTIVE' || args.destination.readyState !== args.destination.OPEN) {
    return
  }
  args.destination.send(args.raw, { binary: args.isBinary })
  const bytes = Array.isArray(args.raw) ? Buffer.concat(args.raw) : Buffer.from(args.raw as Buffer)
  args.recordEvent({
    kind: 'ciphertext-forwarded',
    connId: args.connection.connId,
    direction: args.direction,
    byteLength: bytes.byteLength
  })
}

export function releaseMockCellConnection(args: {
  connection: CellConnection
  reason: string
  releaseAdmission: boolean
  connections: Map<string, CellConnection>
  heldConnectionOpens?: ConnectionOpen[]
  recordEvent: (event: MockCellEvent) => void
}): void {
  const { connection } = args
  if (connection.state === 'CLOSED') {
    return
  }
  connection.state = 'CLOSED'
  if (args.releaseAdmission && connection.grant.state === 'RESERVED') {
    connection.grant.state = 'UNUSED'
  }
  closeMockCellSocket(
    connection.client,
    args.reason === 'INCARNATION_DRAIN'
      ? MOCK_CELL_DRAINING_CLOSE
      : args.reason === 'HOST_ATTACH_TIMEOUT'
        ? MOCK_CELL_HOST_UNAVAILABLE_CLOSE
        : args.reason === 'HOST_UNAVAILABLE'
          ? MOCK_CELL_HOST_UNAVAILABLE_CLOSE
          : MOCK_CELL_POLICY_CLOSE,
    args.reason
  )
  if (connection.hostData) {
    closeMockCellSocket(connection.hostData, MOCK_CELL_POLICY_CLOSE, args.reason)
  }
  const heldIndex = args.heldConnectionOpens?.findIndex(
    (message) => message.connId === connection.connId
  )
  if (heldIndex !== undefined && heldIndex !== -1) {
    args.heldConnectionOpens?.splice(heldIndex, 1)
  }
  args.connections.delete(connection.connId)
  args.recordEvent({
    kind: 'connection-released',
    connId: connection.connId,
    reason: args.reason
  })
}

export function reserveMockCellClient(args: {
  connId: string
  grant: AdmissionRecord
  client: WebSocket
  now: number
  attachTimeoutMs: number
  random?: (size: number) => Uint8Array
  connections: Map<string, CellConnection>
  recordEvent: (event: MockCellEvent) => void
  heldConnectionOpens: ConnectionOpen[]
  holdConnectionOpens: boolean
  onClientClosed: (connection: CellConnection) => void
  sendConnectionOpen: (message: ConnectionOpen) => void
}): void {
  const makeRandom = args.random ?? ((size: number) => randomBytes(size))
  const connTicket = toBase64Url(makeRandom(32))
  const connection: CellConnection = {
    connId: args.connId,
    connTicketSha256: digestMockCellTicket(connTicket),
    grant: args.grant,
    client: args.client,
    hostData: null,
    deadlineMs: args.now + args.attachTimeoutMs,
    state: 'WAIT_HOST_ATTACH'
  }
  args.grant.state = 'RESERVED'
  args.connections.set(args.connId, connection)
  args.recordEvent({ kind: 'client-reserved', connId: args.connId })
  args.client.once('close', () => args.onClientClosed(connection))
  const message: ConnectionOpen = {
    type: 'conn-open',
    v: 2,
    kind: 'ticket',
    connId: args.connId,
    connTicket,
    intentId: args.grant.intentId,
    clientKeyHash: args.grant.clientKeyHash,
    assignmentEpoch: args.grant.binding.assignmentEpoch,
    controlGeneration: args.grant.binding.controlGeneration,
    attachDeadlineMs: args.attachTimeoutMs
  }
  if (args.holdConnectionOpens) {
    args.heldConnectionOpens.push(message)
  } else {
    args.sendConnectionOpen(message)
  }
}
