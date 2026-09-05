import type WebSocket from 'ws'
import type { E2EEKeypair } from '../../runtime/e2ee-keypair'
import { answerHostChallenge } from './hive-runtime-relay-host-proof-v2'
import {
  HostControlInboundSchema,
  parseStrictJson,
  type ConnectionOpen,
  type HostHelloAck
} from './hive-runtime-relay-protocol'
import {
  closeHiveRuntimeRelaySocket,
  createHiveRuntimeRelaySocket,
  hiveRuntimeRelaySocketUrl,
  hiveRuntimeRelayWireBinding,
  hiveRuntimeRelaySameOwner,
  HIVE_RELAY_CLOSE,
  type HiveRuntimeRelaySocketFactory
} from './hive-runtime-relay-socket'
import type { HiveRuntimeRelayAssignment } from './hive-runtime-relay-types'

type Options = {
  assignment: HiveRuntimeRelayAssignment
  keypair: E2EEKeypair
  onConnectionOpen: (message: ConnectionOpen) => void
  onClose: (code: number) => void
  onDrain: (deadlineMs: number) => void
  createSocket?: HiveRuntimeRelaySocketFactory
  now?: () => number
}

export class HiveRuntimeRelayControlClient {
  private socket: WebSocket | null = null
  private state: 'idle' | 'proving' | 'active' | 'closed' = 'idle'
  private proved = false
  private pending: { resolve: (ack: HostHelloAck) => void; reject: (error: Error) => void } | null =
    null
  private handshakeTimer: ReturnType<typeof setTimeout> | null = null
  private leaseTimer: ReturnType<typeof setTimeout> | null = null
  private assignment: HiveRuntimeRelayAssignment
  private expiresAt = 0
  private readonly now: () => number

  constructor(private readonly options: Options) {
    this.assignment = options.assignment
    this.now = options.now ?? Date.now
  }

  get active(): boolean {
    return this.state === 'active'
  }

  connect(): Promise<HostHelloAck> {
    if (this.state !== 'idle') {
      return Promise.reject(new Error('hive_runtime_relay_control_started'))
    }
    this.state = 'proving'
    const ready = this.awaitAck()
    try {
      const socket = (this.options.createSocket ?? createHiveRuntimeRelaySocket)(
        hiveRuntimeRelaySocketUrl(this.assignment.cellOrigin, '/v1/host/control'),
        this.assignment.controlLease
      )
      this.socket = socket
      this.armLease(this.assignment.controlLeaseExpiresAt)
      socket.once('open', () => {
        if (this.state !== 'proving') {
          return
        }
        this.send({
          type: 'host-hello',
          v: 2,
          ...hiveRuntimeRelayWireBinding(this.assignment),
          hostPublicKeyB64: this.assignment.hostPublicKeyB64,
          capabilities: ['ticket-connect-v2']
        })
      })
      socket.on('message', (raw, binary) => {
        if (this.state === 'closed') {
          return
        }
        if (binary || Buffer.byteLength(raw.toString()) > 16_384) {
          this.close(HIVE_RELAY_CLOSE.PROTOCOL_ERROR)
          return
        }
        try {
          this.receive(raw.toString())
        } catch {
          this.close(HIVE_RELAY_CLOSE.PROTOCOL_ERROR)
        }
      })
      socket.once('close', (code) => this.close(code))
      socket.once('error', () => this.close(HIVE_RELAY_CLOSE.SERVICE_RESTART))
    } catch {
      this.close(HIVE_RELAY_CLOSE.SERVICE_RESTART)
    }
    return ready
  }

  refresh(assignment: HiveRuntimeRelayAssignment): Promise<HostHelloAck> {
    if (!this.active || this.pending || !hiveRuntimeRelaySameOwner(this.assignment, assignment)) {
      return Promise.reject(new Error('hive_runtime_relay_refresh_rejected'))
    }
    this.assignment = assignment
    const result = this.awaitAck()
    this.send({ type: 'auth-refresh', v: 2, controlLease: assignment.controlLease })
    return result
  }

  close(code = HIVE_RELAY_CLOSE.NORMAL): void {
    if (this.state === 'closed') {
      return
    }
    this.state = 'closed'
    if (this.handshakeTimer) {
      clearTimeout(this.handshakeTimer)
    }
    if (this.leaseTimer) {
      clearTimeout(this.leaseTimer)
    }
    this.handshakeTimer = this.leaseTimer = null
    this.pending?.reject(new Error('hive_runtime_relay_control_closed'))
    this.pending = null
    const socket = this.socket
    this.socket = null
    // Bound shutdown even when a peer never acknowledges the close frame.
    if (socket) {
      closeHiveRuntimeRelaySocket(socket, code)
    }
    this.options.onClose(code)
  }

  private awaitAck(): Promise<HostHelloAck> {
    const result = new Promise<HostHelloAck>((resolve, reject) => {
      this.pending = { resolve, reject }
    })
    void result.catch(() => undefined)
    this.handshakeTimer = setTimeout(() => this.close(HIVE_RELAY_CLOSE.AUTH_TIMEOUT), 5_000)
    return result
  }

  private armLease(expiresAt: number): void {
    if (expiresAt <= this.now()) {
      this.close(HIVE_RELAY_CLOSE.AUTH_REQUIRED)
      return
    }
    if (expiresAt <= this.expiresAt) {
      return
    }
    this.expiresAt = expiresAt
    if (this.leaseTimer) {
      clearTimeout(this.leaseTimer)
    }
    this.leaseTimer = setTimeout(
      () => this.close(HIVE_RELAY_CLOSE.AUTH_REQUIRED),
      expiresAt - this.now()
    )
  }

  private send(value: object): void {
    if (!this.socket || this.socket.readyState !== 1 || this.socket.bufferedAmount > 16_384) {
      this.close(HIVE_RELAY_CLOSE.CAPACITY_EXCEEDED)
      return
    }
    try {
      this.socket.send(JSON.stringify(value), (error) => {
        if (error) {
          this.close(HIVE_RELAY_CLOSE.SERVICE_RESTART)
        }
      })
    } catch {
      this.close(HIVE_RELAY_CLOSE.SERVICE_RESTART)
    }
  }

  private receive(raw: string): void {
    const message = parseStrictJson(raw, HostControlInboundSchema)
    if (message.type === 'host-challenge') {
      if (this.state !== 'proving' || this.proved) {
        throw new Error('unexpected_challenge')
      }
      const answer = answerHostChallenge({
        challenge: message,
        binding: hiveRuntimeRelayWireBinding(this.assignment),
        cellOrigin: this.assignment.cellOrigin,
        hostPublicKey: this.options.keypair.publicKey,
        hostSecretKey: this.options.keypair.secretKey,
        now: this.now()
      })
      if (!answer) {
        throw new Error('invalid_challenge')
      }
      this.proved = true
      this.send(answer)
      return
    }
    if (message.type === 'host-hello-ack') {
      if (
        !this.proved ||
        !this.pending ||
        message.controlGeneration !== this.assignment.controlGeneration ||
        message.leaseExpiresAt !== this.assignment.controlLeaseExpiresAt ||
        message.leaseExpiresAt <= this.now()
      ) {
        throw new Error('invalid_ack')
      }
      this.armLease(message.leaseExpiresAt)
      if (this.state === 'closed') {
        return
      }
      this.state = 'active'
      if (this.handshakeTimer) {
        clearTimeout(this.handshakeTimer)
      }
      this.handshakeTimer = null
      const pending = this.pending
      this.pending = null
      pending?.resolve(message)
      return
    }
    if (!this.active) {
      throw new Error('control_not_active')
    }
    if (message.type === 'drain') {
      this.options.onDrain(message.deadlineMs)
      this.close(HIVE_RELAY_CLOSE.DRAINING)
    } else {
      if (
        message.assignmentEpoch !== this.assignment.assignmentEpoch ||
        message.controlGeneration !== this.assignment.controlGeneration
      ) {
        throw new Error('stale_connection')
      }
      this.options.onConnectionOpen(message)
    }
  }
}
