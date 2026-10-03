import type WebSocket from 'ws'
import {
  RelayHelloSchema,
  parseStrictJson,
  type ConnectionOpen
} from './hive-runtime-relay-protocol'
import {
  closeHiveRuntimeRelaySocket,
  createHiveRuntimeRelaySocket,
  hiveRuntimeRelaySocketUrl,
  HIVE_RELAY_CLOSE,
  type HiveRuntimeRelaySocketFactory
} from './hive-runtime-relay-socket'
import type { HiveRuntimeRelayAssignment } from './hive-runtime-relay-types'

type Options = {
  assignment: HiveRuntimeRelayAssignment
  connection: ConnectionOpen
  isCurrent: () => boolean
  onReady: (socket: WebSocket) => void
  onMessage: (message: string | Uint8Array<ArrayBufferLike>) => void
  onClose: () => void
  createSocket?: HiveRuntimeRelaySocketFactory
}

/** One connTicket authorizes exactly one attach; failures require a new conn-open. */
export class HiveRuntimeRelayDataTransport {
  private socket: WebSocket | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private state: 'idle' | 'attaching' | 'ready' | 'closed' = 'idle'

  constructor(private readonly options: Options) {}

  connect(): void {
    if (this.state !== 'idle') {
      throw new Error('hive_runtime_relay_data_started')
    }
    const { assignment, connection } = this.options
    if (
      !this.options.isCurrent() ||
      connection.assignmentEpoch !== assignment.assignmentEpoch ||
      connection.controlGeneration !== assignment.controlGeneration
    ) {
      this.close(HIVE_RELAY_CLOSE.STALE_BINDING)
      return
    }
    this.state = 'attaching'
    this.timer = setTimeout(
      () => this.close(HIVE_RELAY_CLOSE.AUTH_TIMEOUT),
      Math.min(connection.attachDeadlineMs, 5_000)
    )
    try {
      const socket = (this.options.createSocket ?? createHiveRuntimeRelaySocket)(
        hiveRuntimeRelaySocketUrl(
          assignment.cellOrigin,
          `/v1/host/data/${encodeURIComponent(connection.connId)}`
        )
      )
      this.socket = socket
      socket.once('open', () => {
        if (!this.options.isCurrent() || this.state !== 'attaching') {
          this.close()
          return
        }
        // The business ticketSecret is available only inside E2EE, never here.
        socket.send(
          JSON.stringify({
            type: 'host-data-auth',
            v: 2,
            connId: connection.connId,
            connTicket: connection.connTicket,
            assignmentEpoch: connection.assignmentEpoch,
            controlGeneration: connection.controlGeneration
          }),
          (error) => {
            if (error) {
              this.close()
            }
          }
        )
      })
      socket.on('message', (raw, binary) => {
        if (this.state === 'closed') {
          return
        }
        if (!this.options.isCurrent()) {
          this.close(HIVE_RELAY_CLOSE.STALE_BINDING)
          return
        }
        try {
          if (this.state === 'attaching') {
            if (binary || Buffer.byteLength(raw.toString()) > 16_384) {
              throw new Error('invalid_hello')
            }
            const hello = parseStrictJson(raw.toString(), RelayHelloSchema)
            if (
              hello.connId !== connection.connId ||
              hello.cellId !== assignment.cellId ||
              hello.cellIncarnationId !== assignment.cellIncarnationId
            ) {
              throw new Error('invalid_binding')
            }
            if (this.timer) {
              clearTimeout(this.timer)
            }
            this.timer = null
            this.state = 'ready'
            this.options.onReady(socket)
          } else {
            const bytes = Array.isArray(raw)
              ? Buffer.concat(raw)
              : raw instanceof ArrayBuffer
                ? new Uint8Array(raw)
                : raw
            this.options.onMessage(binary ? bytes : raw.toString())
          }
        } catch {
          this.close(HIVE_RELAY_CLOSE.PROTOCOL_ERROR)
        }
      })
      socket.once('close', () => this.close())
      socket.once('error', () => this.close(HIVE_RELAY_CLOSE.SERVICE_RESTART))
    } catch {
      this.close(HIVE_RELAY_CLOSE.SERVICE_RESTART)
    }
  }

  close(code = HIVE_RELAY_CLOSE.NORMAL): void {
    if (this.state === 'closed') {
      return
    }
    this.state = 'closed'
    if (this.timer) {
      clearTimeout(this.timer)
    }
    this.timer = null
    const socket = this.socket
    this.socket = null
    if (socket) {
      closeHiveRuntimeRelaySocket(socket, code)
    }
    this.options.onClose()
  }
}
