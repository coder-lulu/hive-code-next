import { registerMockCellAdmissionGrant } from './hiverelay-mock-cell-admission-grants'
import { timingSafeEqual } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import type { WebSocket } from 'ws'
import { acceptMockCellControl } from './hiverelay-mock-cell-control'
import { HiveRelayMockCellServer, type MockCellRoute } from './hiverelay-mock-cell-server'
import {
  HostDataAuthSchema,
  parseStrictJson,
  type ConnectionOpen,
  type HostHello
} from './hiverelay-test-wire'
import { acceptMockCellClient } from './hiverelay-mock-cell-client'
import { wireText } from './hiverelay-websocket-peer'
import {
  MOCK_CELL_POLICY_CLOSE,
  MOCK_CELL_AUTH_TIMEOUT_CLOSE,
  MOCK_CELL_DRAINING_CLOSE,
  MOCK_CELL_STALE_BINDING_CLOSE,
  closeMockCellSocket,
  createMockCellConnectionId,
  digestMockCellCredential,
  digestMockCellTicket,
  forwardMockCellCiphertext,
  releaseMockCellConnection,
  reserveMockCellClient,
  sendMockCellJson,
  type AdmissionRecord,
  type MockAdmissionGrant,
  type CellConnection,
  type MockCellEvent,
  MockCellEventLog,
  type ProgrammableMockCellOptions
} from './hiverelay-mock-cell-state'

export type { MockAdmissionGrant, MockCellEvent } from './hiverelay-mock-cell-state'

export class ProgrammableHiveRelayMockCell {
  private readonly server: HiveRelayMockCellServer
  private readonly admissions = new Map<string, AdmissionRecord>()
  private readonly connections = new Map<string, CellConnection>()
  private readonly heldConnectionOpens: ConnectionOpen[] = []
  private readonly preAuthClients = new Set<WebSocket>()
  private readonly eventLog: MockCellEventLog
  private currentIncarnationId: string
  private control: WebSocket | null = null
  private hostHello: HostHello | null = null
  private connectionSequence = 0
  private draining = false
  private holdConnectionOpens: boolean

  constructor(private readonly options: ProgrammableMockCellOptions) {
    this.eventLog = new MockCellEventLog(options.eventCapacity ?? 1_024)
    this.currentIncarnationId = options.binding.cellIncarnationId
    this.holdConnectionOpens = options.holdConnectionOpens ?? false
    options.admissionGrants.forEach((grant) => this.registerAdmissionGrant(grant))
    this.server = new HiveRelayMockCellServer(this.acceptRoute.bind(this))
  }

  registerAdmissionGrant(grant: MockAdmissionGrant): void {
    registerMockCellAdmissionGrant(this.admissions, grant)
  }

  get baseUrl(): string {
    return this.server.baseUrl
  }

  get events(): MockCellEvent[] {
    return this.eventLog.snapshot()
  }

  async start(): Promise<void> {
    await this.server.start()
  }

  releaseConnectionOpens(order: 'fifo' | 'reverse' = 'fifo'): void {
    const messages = this.heldConnectionOpens.splice(0)
    if (order === 'reverse') {
      messages.reverse()
    }
    for (const message of messages) {
      if (this.connections.get(message.connId)?.state === 'WAIT_HOST_ATTACH') {
        this.sendConnectionOpen(message)
      }
    }
  }

  pendingConnectionIds(): string[] {
    return [...this.connections.values()]
      .filter((connection) => connection.state === 'WAIT_HOST_ATTACH')
      .map((connection) => connection.connId)
  }

  admissionState(token: string): AdmissionRecord['state'] | null {
    return this.admissions.get(digestMockCellCredential(token))?.state ?? null
  }

  expirePending(): void {
    const now = (this.options.now ?? Date.now)()
    for (const connection of this.connections.values()) {
      if (connection.state === 'WAIT_HOST_ATTACH' && now > connection.deadlineMs) {
        this.release(connection, 'HOST_ATTACH_TIMEOUT', true)
      }
    }
  }

  beginDrain(deadlineMs: number): void {
    this.draining = true
    this.recordEvent({ kind: 'drain-started' })
    if (this.control) {
      sendMockCellJson(this.control, {
        type: 'drain',
        v: 2,
        deadlineMs,
        reason: 'INCARNATION_DRAIN'
      })
    }
  }

  finishDrain(): void {
    for (const connection of this.connections.values()) {
      this.release(connection, 'INCARNATION_DRAIN', connection.state === 'WAIT_HOST_ATTACH')
    }
    if (this.control) {
      closeMockCellSocket(this.control, MOCK_CELL_DRAINING_CLOSE, 'DRAINING')
    }
  }

  rotateIncarnation(nextIncarnationId: string): void {
    this.currentIncarnationId = nextIncarnationId
    this.recordEvent({ kind: 'incarnation-rotated' })
    for (const connection of this.connections.values()) {
      this.release(connection, 'STALE_BINDING', connection.state === 'WAIT_HOST_ATTACH')
    }
    if (this.control) {
      closeMockCellSocket(this.control, MOCK_CELL_STALE_BINDING_CLOSE, 'STALE_BINDING')
    }
    this.control = null
    this.hostHello = null
  }

  async stop(): Promise<void> {
    await this.server.stop()
  }

  dropControl(): void {
    if (this.control) {
      closeMockCellSocket(this.control, 1012, 'SERVICE_RESTART')
    }
  }

  private acceptRoute(socket: WebSocket, request: IncomingMessage, route: MockCellRoute): void {
    if (route.kind === 'control') {
      this.acceptControl(socket, request)
    } else if (route.kind === 'host-data') {
      this.acceptHostData(socket, route.connId)
    } else {
      this.acceptClient(socket, request, route.relayHostId)
    }
  }

  private acceptControl(socket: WebSocket, request: IncomingMessage): void {
    acceptMockCellControl({
      socket,
      request,
      options: this.options,
      currentIncarnationId: this.currentIncarnationId,
      draining: this.draining,
      onActive: (activeSocket, hello) => {
        this.control = activeSocket
        this.hostHello = hello
        this.recordEvent({ kind: 'host-active' })
      },
      onClosed: (closedSocket) => {
        if (this.control === closedSocket) {
          this.control = null
          this.hostHello = null
          for (const connection of this.connections.values()) {
            this.release(connection, 'HOST_UNAVAILABLE', connection.state === 'WAIT_HOST_ATTACH')
          }
        }
      }
    })
  }

  private acceptClient(socket: WebSocket, request: IncomingMessage, routeHostId: string): void {
    acceptMockCellClient({
      socket,
      request,
      routeHostId,
      options: this.options,
      draining: this.draining,
      currentIncarnationId: this.currentIncarnationId,
      hostHello: this.hostHello,
      admissions: this.admissions,
      connections: this.connections,
      preAuthClients: this.preAuthClients,
      reserveClient: (client, grant) => this.reserveClient(client, grant)
    })
  }
  private reserveClient(socket: WebSocket, grant: AdmissionRecord): void {
    const sequence = ++this.connectionSequence
    const connId = createMockCellConnectionId(sequence, this.options.random)
    reserveMockCellClient({
      connId,
      grant,
      client: socket,
      now: (this.options.now ?? Date.now)(),
      attachTimeoutMs: this.options.attachTimeoutMs ?? 5_000,
      random: this.options.random,
      connections: this.connections,
      recordEvent: (event) => this.recordEvent(event),
      heldConnectionOpens: this.heldConnectionOpens,
      holdConnectionOpens: this.holdConnectionOpens,
      onClientClosed: (connection) => {
        if (connection.state === 'WAIT_HOST_ATTACH') {
          this.release(connection, 'CLIENT_CLOSED_BEFORE_READY', true)
        }
      },
      sendConnectionOpen: (message) => this.sendConnectionOpen(message)
    })
  }

  private sendConnectionOpen(message: ConnectionOpen): void {
    if (!this.control) {
      const connection = this.connections.get(message.connId)
      if (connection) {
        this.release(connection, 'HOST_UNAVAILABLE', true)
      }
      return
    }
    sendMockCellJson(this.control, message)
    this.recordEvent({ kind: 'connection-open-sent', connId: message.connId })
  }

  private acceptHostData(socket: WebSocket, routeConnId: string): void {
    const preAuthTimeout = setTimeout(() => {
      closeMockCellSocket(socket, MOCK_CELL_AUTH_TIMEOUT_CLOSE, 'AUTH_TIMEOUT')
    }, this.options.preAuthTimeoutMs ?? 5_000)
    preAuthTimeout.unref()
    socket.once('close', () => clearTimeout(preAuthTimeout))
    socket.once('message', (raw, isBinary) => {
      clearTimeout(preAuthTimeout)
      if (isBinary) {
        closeMockCellSocket(socket, MOCK_CELL_POLICY_CLOSE, 'INVALID_HOST_DATA_AUTH')
        return
      }
      try {
        const auth = parseStrictJson(wireText(raw), HostDataAuthSchema)
        const connection = this.connections.get(routeConnId)
        if (
          !connection ||
          connection.state !== 'WAIT_HOST_ATTACH' ||
          auth.connId !== routeConnId ||
          !timingSafeEqual(digestMockCellTicket(auth.connTicket), connection.connTicketSha256) ||
          auth.assignmentEpoch !== connection.grant.binding.assignmentEpoch ||
          auth.controlGeneration !== connection.grant.binding.controlGeneration ||
          (this.options.now ?? Date.now)() > connection.deadlineMs
        ) {
          throw new Error('Host data binding mismatch')
        }
        this.activate(connection, socket)
      } catch {
        closeMockCellSocket(socket, MOCK_CELL_POLICY_CLOSE, 'INVALID_HOST_DATA_AUTH')
      }
    })
  }

  private activate(connection: CellConnection, hostData: WebSocket): void {
    connection.hostData = hostData
    connection.state = 'ACTIVE'
    connection.grant.state = 'CONSUMED'
    this.recordEvent({ kind: 'connection-active', connId: connection.connId })
    const hello = {
      type: 'relay-hello',
      v: 2,
      connId: connection.connId,
      cellId: this.options.relayHelloBindingOverride?.cellId ?? connection.grant.binding.cellId,
      cellIncarnationId:
        this.options.relayHelloBindingOverride?.cellIncarnationId ??
        connection.grant.binding.cellIncarnationId
    } as const
    sendMockCellJson(connection.client, hello)
    sendMockCellJson(hostData, hello)
    connection.client.on('message', (raw, isBinary) =>
      forwardMockCellCiphertext({
        connection,
        direction: 'client-to-host',
        destination: hostData,
        raw,
        isBinary,
        recordEvent: (event) => this.recordEvent(event)
      })
    )
    hostData.on('message', (raw, isBinary) =>
      forwardMockCellCiphertext({
        connection,
        direction: 'host-to-client',
        destination: connection.client,
        raw,
        isBinary,
        recordEvent: (event) => this.recordEvent(event)
      })
    )
    hostData.once('close', () => this.release(connection, 'HOST_DATA_CLOSED', false))
    connection.client.once('close', () => this.release(connection, 'CLIENT_CLOSED', false))
  }

  private release(connection: CellConnection, reason: string, releaseAdmission: boolean): void {
    releaseMockCellConnection({
      connection,
      reason,
      releaseAdmission,
      connections: this.connections,
      heldConnectionOpens: this.heldConnectionOpens,
      recordEvent: (event) => this.recordEvent(event)
    })
  }

  private recordEvent(event: MockCellEvent): void {
    this.eventLog.push(event)
  }
}
