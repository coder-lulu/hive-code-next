import type { IncomingMessage } from 'node:http'
import type { WebSocket } from 'ws'
import { acceptMockCellControl } from './hiverelay-mock-cell-control'
import { HiveRelayMockCellServer, type MockCellRoute } from './hiverelay-mock-cell-server'
import {
  ClientAdmissionSchema,
  HostDataAuthSchema,
  deriveHiveRelayKeyHash,
  fromBase64Url,
  parseStrictJson,
  type ClientAdmission,
  type ConnectionOpen,
  type HostHello
} from './hiverelay-test-wire'
import { wireText } from './hiverelay-websocket-peer'
import {
  MOCK_CELL_POLICY_CLOSE,
  MOCK_CELL_DRAINING_CLOSE,
  MOCK_CELL_REPLAY_CLOSE,
  MOCK_CELL_STALE_BINDING_CLOSE,
  closeMockCellSocket,
  forwardMockCellCiphertext,
  releaseMockCellConnection,
  reserveMockCellClient,
  sameMockCellBinding,
  sendMockCellJson,
  type AdmissionRecord,
  type CellConnection,
  type MockCellEvent,
  type ProgrammableMockCellOptions
} from './hiverelay-mock-cell-state'

export type { MockAdmissionGrant, MockCellEvent } from './hiverelay-mock-cell-state'

export class ProgrammableHiveRelayMockCell {
  readonly events: MockCellEvent[] = []

  private readonly server: HiveRelayMockCellServer
  private readonly admissions = new Map<string, AdmissionRecord>()
  private readonly connections = new Map<string, CellConnection>()
  private readonly heldConnectionOpens: ConnectionOpen[] = []
  private currentIncarnationId: string
  private control: WebSocket | null = null
  private hostHello: HostHello | null = null
  private connectionSequence = 0
  private draining = false
  private holdConnectionOpens: boolean

  constructor(private readonly options: ProgrammableMockCellOptions) {
    this.currentIncarnationId = options.binding.cellIncarnationId
    this.holdConnectionOpens = options.holdConnectionOpens ?? false
    for (const grant of options.admissionGrants) {
      if (this.admissions.has(grant.token)) {
        throw new Error('Duplicate mock admission token')
      }
      this.admissions.set(grant.token, { ...grant, state: 'UNUSED' })
    }
    this.server = new HiveRelayMockCellServer((socket, request, route) =>
      this.acceptRoute(socket, request, route)
    )
  }

  get baseUrl(): string {
    return this.server.baseUrl
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
    this.events.push({ kind: 'drain-started' })
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
      this.release(connection, 'INCARNATION_DRAIN', false)
    }
    if (this.control) {
      closeMockCellSocket(this.control, MOCK_CELL_DRAINING_CLOSE, 'DRAINING')
    }
  }

  rotateIncarnation(nextIncarnationId: string): void {
    this.currentIncarnationId = nextIncarnationId
    this.events.push({ kind: 'incarnation-rotated' })
    for (const connection of this.connections.values()) {
      this.release(connection, 'STALE_BINDING', false)
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

  private acceptRoute(socket: WebSocket, request: IncomingMessage, route: MockCellRoute): void {
    if (route.kind === 'control') {
      this.acceptControl(socket, request)
    } else if (route.kind === 'host-data') {
      this.acceptHostData(socket, route.connId)
    } else {
      this.acceptClient(socket, route.relayHostId)
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
        this.events.push({ kind: 'host-active' })
      },
      onClosed: (closedSocket) => {
        if (this.control === closedSocket) {
          this.control = null
          this.hostHello = null
        }
      }
    })
  }

  private acceptClient(socket: WebSocket, routeHostId: string): void {
    socket.once('message', (raw, isBinary) => {
      if (isBinary) {
        closeMockCellSocket(socket, MOCK_CELL_POLICY_CLOSE, 'INVALID_CLIENT_ADMISSION')
        return
      }
      let admission: ClientAdmission
      try {
        admission = parseStrictJson(wireText(raw), ClientAdmissionSchema)
      } catch {
        closeMockCellSocket(socket, MOCK_CELL_POLICY_CLOSE, 'INVALID_CLIENT_ADMISSION')
        return
      }
      const grant = this.admissions.get(admission.clientAdmissionToken)
      const clientKey = fromBase64Url(admission.clientPublicKeyB64, 32)
      if (this.draining) {
        closeMockCellSocket(socket, MOCK_CELL_DRAINING_CLOSE, 'DRAINING')
      } else if (!grant || grant.state !== 'UNUSED') {
        closeMockCellSocket(
          socket,
          grant?.state === 'CONSUMED' ? MOCK_CELL_REPLAY_CLOSE : MOCK_CELL_POLICY_CLOSE,
          grant?.state === 'CONSUMED' ? 'REPLAY_DETECTED' : 'INVALID_ADMISSION'
        )
      } else if (
        routeHostId !== grant.binding.relayHostId ||
        !clientKey ||
        grant.clientPublicKeyB64 !== admission.clientPublicKeyB64 ||
        grant.clientKeyHash !== deriveHiveRelayKeyHash(clientKey) ||
        !this.hostHello ||
        !sameMockCellBinding(grant.binding, this.hostHello) ||
        grant.binding.cellIncarnationId !== this.currentIncarnationId
      ) {
        closeMockCellSocket(socket, MOCK_CELL_STALE_BINDING_CLOSE, 'STALE_BINDING')
      } else {
        this.reserveClient(socket, grant)
      }
    })
  }

  private reserveClient(socket: WebSocket, grant: AdmissionRecord): void {
    const connId = `conn-${++this.connectionSequence}`
    reserveMockCellClient({
      connId,
      grant,
      client: socket,
      now: (this.options.now ?? Date.now)(),
      attachTimeoutMs: this.options.attachTimeoutMs ?? 5_000,
      random: this.options.random,
      connections: this.connections,
      events: this.events,
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
    this.events.push({ kind: 'connection-open-sent', connId: message.connId })
  }

  private acceptHostData(socket: WebSocket, routeConnId: string): void {
    socket.once('message', (raw, isBinary) => {
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
          auth.connTicket !== connection.connTicket ||
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
    this.events.push({ kind: 'connection-active', connId: connection.connId })
    const hello = {
      type: 'relay-hello',
      v: 2,
      connId: connection.connId,
      cellId: connection.grant.binding.cellId,
      cellIncarnationId: connection.grant.binding.cellIncarnationId
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
        events: this.events
      })
    )
    hostData.on('message', (raw, isBinary) =>
      forwardMockCellCiphertext({
        connection,
        direction: 'host-to-client',
        destination: connection.client,
        raw,
        isBinary,
        events: this.events
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
      events: this.events
    })
  }
}
