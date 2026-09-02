import nacl from 'tweetnacl'
import type WebSocketClient from 'ws'
import {
  HIVE_RELAY_CLIENT_PATH_PREFIX,
  RelayHelloSchema,
  parseStrictJson,
  toBase64Url,
  type RelayHello
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

export type ReferenceClientOptions = {
  cellUrl: string
  relayHostId: string
  clientAdmissionToken: string
  origin?: string
  expectedCellId: string
  expectedCellIncarnationId: string
  keys?: nacl.BoxKeyPair
}

export class HiveRelayPeerClosedError extends Error {
  constructor(
    readonly code: number,
    readonly reason: string
  ) {
    super(`HiveRelay peer closed:${code}:${reason}`)
  }
}

export class ReferenceHiveRelayClient {
  readonly publicKey: Uint8Array
  readonly publicKeyB64: string

  private readonly ready = deferred<RelayHello>()
  private readonly closed: Deferred<HiveRelayPeerClosedError> = deferred()
  private readonly inbox = new BinaryInbox()
  private socket: WebSocketClient | null = null

  constructor(private readonly options: ReferenceClientOptions) {
    const keys = options.keys ?? nacl.box.keyPair()
    this.publicKey = keys.publicKey
    this.publicKeyB64 = toBase64Url(keys.publicKey)
  }

  async connect(): Promise<RelayHello> {
    if (this.socket) {
      throw new Error('Reference Client is already connected')
    }
    const socket = openWebSocket(
      this.options.cellUrl,
      `${HIVE_RELAY_CLIENT_PATH_PREFIX}${encodeURIComponent(this.options.relayHostId)}`,
      { origin: this.options.origin }
    )
    this.socket = socket
    socket.on('message', (raw, isBinary) => {
      if (isBinary) {
        queueBinaryFrame(socket, this.inbox, raw)
        return
      }
      try {
        const hello = parseStrictJson(wireText(raw), RelayHelloSchema)
        if (
          hello.cellId !== this.options.expectedCellId ||
          hello.cellIncarnationId !== this.options.expectedCellIncarnationId
        ) {
          throw new Error('Client relay acknowledgement binding mismatch')
        }
        this.ready.resolve(hello)
      } catch (error) {
        this.ready.reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
    socket.once('close', (code, reason) => {
      const error = new HiveRelayPeerClosedError(code, reason.toString())
      this.ready.reject(error)
      this.inbox.reject(error)
      this.closed.resolve(error)
    })
    socket.once('error', (error) => {
      this.ready.reject(error)
      this.inbox.reject(error)
    })
    await waitForOpen(socket)
    sendJson(socket, {
      type: 'relay-auth',
      v: 2,
      clientAdmissionToken: this.options.clientAdmissionToken,
      clientPublicKeyB64: this.publicKeyB64
    })
    return this.ready.promise
  }

  sendCiphertext(bytes: Uint8Array): void {
    if (!this.socket || !this.ready.resolved()) {
      throw new Error('Reference Client is not ready')
    }
    this.socket.send(bytes, { binary: true })
  }

  nextCiphertext(): Promise<Uint8Array> {
    return this.inbox.next()
  }

  waitForClose(): Promise<HiveRelayPeerClosedError> {
    return this.closed.promise
  }

  close(): void {
    this.socket?.close(1000)
    this.socket = null
  }
}
