import nacl from 'tweetnacl'
import type WebSocketClient from 'ws'
import { answerHostChallenge } from './hiverelay-host-proof'
import {
  ConnectionOpenSchema,
  HIVE_RELAY_HOST_CONTROL_PATH,
  HIVE_RELAY_HOST_DATA_PATH_PREFIX,
  HostControlInboundSchema,
  RelayHelloSchema,
  deriveHiveRelayHostId,
  parseStrictJson,
  toBase64Url,
  type ConnectionOpen,
  type HiveRelayBinding,
  type HostHelloAck
} from './hiverelay-test-wire'
import {
  BinaryInbox,
  deferred,
  openWebSocket,
  queueBinaryFrame,
  sendJson,
  waitForOpen,
  wireText,
  type Deferred
} from './hiverelay-websocket-peer'

export type ReferenceHostOptions = {
  cellUrl: string
  cellOrigin: string
  controlLease: string
  binding: HiveRelayBinding
  keys?: nacl.BoxKeyPair
  now?: () => number
  autoAttach?: boolean
  historyCapacity?: number
  onConnectionOpen?: (message: ConnectionOpen) => void
}

type DataConnection = {
  socket: WebSocketClient
  ready: Deferred<void>
  inbox: BinaryInbox
}

export class ReferenceHiveRelayHost {
  readonly publicKey: Uint8Array
  readonly publicKeyB64: string
  readonly openedConnectionIds: string[] = []
  readonly drainDeadlines: number[] = []

  private readonly secretKey: Uint8Array
  private readonly pending = new Map<string, ConnectionOpen>()
  private readonly data = new Map<string, DataConnection>()
  private readonly controlReady = deferred<HostHelloAck>()
  private readonly historyCapacity: number
  private control: WebSocketClient | null = null
  private autoAttach: boolean

  constructor(private readonly options: ReferenceHostOptions) {
    const keys = options.keys ?? nacl.box.keyPair()
    this.publicKey = keys.publicKey
    this.secretKey = keys.secretKey
    this.publicKeyB64 = toBase64Url(keys.publicKey)
    this.autoAttach = options.autoAttach ?? true
    this.historyCapacity = options.historyCapacity ?? 1_024
    if (!Number.isSafeInteger(this.historyCapacity) || this.historyCapacity < 1) {
      throw new Error('Reference Host history capacity must be a positive safe integer')
    }
    if (deriveHiveRelayHostId(keys.publicKey) !== options.binding.relayHostId) {
      throw new Error('Reference Host key does not match relayHostId')
    }
  }

  async connect(): Promise<HostHelloAck> {
    if (this.control) {
      throw new Error('Reference Host control is already connected')
    }
    const socket = openWebSocket(this.options.cellUrl, HIVE_RELAY_HOST_CONTROL_PATH, {
      authorization: this.options.controlLease
    })
    this.control = socket
    socket.on('message', (raw, isBinary) => {
      if (isBinary) {
        this.failControl(new Error('Reference Host received binary control data'))
        return
      }
      this.handleControlMessage(wireText(raw))
    })
    socket.once('close', (code, reason) => {
      this.failControl(new Error(`Host control closed:${code}:${reason.toString()}`))
    })
    socket.once('error', (error) => this.failControl(error))
    await waitForOpen(socket)
    sendJson(socket, {
      type: 'host-hello',
      v: 2,
      ...this.options.binding,
      hostPublicKeyB64: this.publicKeyB64,
      capabilities: ['ticket-connect-v2']
    })
    return this.controlReady.promise
  }

  setAutoAttach(enabled: boolean): void {
    this.autoAttach = enabled
  }

  pendingConnectionIds(): string[] {
    return [...this.pending.keys()]
  }

  async attachPending(connId: string): Promise<void> {
    const message = this.pending.get(connId)
    if (!message) {
      throw new Error(`No pending HiveRelay connection: ${connId}`)
    }
    this.pending.delete(connId)
    await this.attach(message)
  }

  waitForAttached(connId: string): Promise<void> {
    const connection = this.data.get(connId)
    if (!connection) {
      throw new Error(`HiveRelay data connection has not started: ${connId}`)
    }
    return connection.ready.promise
  }

  sendCiphertext(connId: string, bytes: Uint8Array): void {
    const connection = this.readyData(connId)
    connection.socket.send(bytes, { binary: true })
  }

  nextCiphertext(connId: string): Promise<Uint8Array> {
    return this.readyData(connId).inbox.next()
  }

  close(): void {
    this.control?.close(1000)
    this.control = null
    for (const connection of this.data.values()) {
      connection.socket.close(1000)
    }
    this.pending.clear()
    this.data.clear()
  }

  private handleControlMessage(raw: string): void {
    let message
    try {
      message = parseStrictJson(raw, HostControlInboundSchema)
    } catch (error) {
      this.failControl(error instanceof Error ? error : new Error(String(error)))
      return
    }
    if (message.type === 'host-challenge') {
      const response = answerHostChallenge({
        challenge: message,
        binding: this.options.binding,
        cellOrigin: this.options.cellOrigin,
        hostPublicKey: this.publicKey,
        hostSecretKey: this.secretKey,
        now: (this.options.now ?? Date.now)()
      })
      if (!response || !this.control) {
        this.failControl(new Error('Reference Host rejected Cell challenge'))
        return
      }
      sendJson(this.control, response)
      return
    }
    if (message.type === 'host-hello-ack') {
      this.controlReady.resolve(message)
      return
    }
    if (message.type === 'conn-open') {
      const connectionOpen = ConnectionOpenSchema.parse(message)
      this.pending.set(connectionOpen.connId, connectionOpen)
      this.recordHistory(this.openedConnectionIds, connectionOpen.connId)
      this.options.onConnectionOpen?.(connectionOpen)
      if (this.autoAttach) {
        void this.attachPending(connectionOpen.connId).catch((error: unknown) => {
          this.failControl(error instanceof Error ? error : new Error(String(error)))
        })
      }
      return
    }
    this.recordHistory(this.drainDeadlines, message.deadlineMs)
  }

  private async attach(message: ConnectionOpen): Promise<void> {
    if (this.data.has(message.connId)) {
      throw new Error(`Duplicate HiveRelay data connection: ${message.connId}`)
    }
    const socket = openWebSocket(
      this.options.cellUrl,
      `${HIVE_RELAY_HOST_DATA_PATH_PREFIX}${encodeURIComponent(message.connId)}`
    )
    const connection: DataConnection = {
      socket,
      ready: deferred<void>(),
      inbox: new BinaryInbox()
    }
    this.data.set(message.connId, connection)
    socket.on('message', (raw, isBinary) => {
      if (isBinary) {
        queueBinaryFrame(socket, connection.inbox, raw)
        return
      }
      try {
        const hello = parseStrictJson(wireText(raw), RelayHelloSchema)
        if (
          hello.connId !== message.connId ||
          hello.cellId !== this.options.binding.cellId ||
          hello.cellIncarnationId !== this.options.binding.cellIncarnationId
        ) {
          throw new Error('Host data acknowledgement binding mismatch')
        }
        connection.ready.resolve()
      } catch (error) {
        connection.ready.reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
    socket.once('close', (code, reason) => {
      const error = new Error(`Host data closed:${code}:${reason.toString()}`)
      connection.ready.reject(error)
      connection.inbox.reject(error)
      if (this.data.get(message.connId) === connection) {
        this.data.delete(message.connId)
      }
    })
    socket.once('error', (error) => {
      connection.ready.reject(error)
      connection.inbox.reject(error)
    })
    await waitForOpen(socket)
    sendJson(socket, {
      type: 'host-data-auth',
      v: 2,
      connId: message.connId,
      connTicket: message.connTicket,
      assignmentEpoch: message.assignmentEpoch,
      controlGeneration: message.controlGeneration
    })
    await connection.ready.promise
  }

  private readyData(connId: string): DataConnection {
    const connection = this.data.get(connId)
    if (!connection || !connection.ready.resolved()) {
      throw new Error(`HiveRelay data connection is not ready: ${connId}`)
    }
    return connection
  }

  private failControl(error: Error): void {
    this.controlReady.reject(error)
    this.pending.clear()
    for (const connection of this.data.values()) {
      connection.ready.reject(error)
      connection.inbox.reject(error)
      connection.socket.close(1012, 'CONTROL_UNAVAILABLE')
    }
    this.data.clear()
    this.control?.close(1008)
  }

  private recordHistory<T>(history: T[], value: T): void {
    if (history.length === this.historyCapacity) {
      history.shift()
    }
    history.push(value)
  }
}
