import { publicKeyToBase64 } from './e2ee'
import { MobileE2EEV2ClientSession } from './mobile-e2ee-v2-client-session'
import {
  MobileE2EEAuthenticationError,
  MobileE2EEV2PhysicalChannel
} from './mobile-e2ee-v2-physical-channel'
import { isRpcResponse } from './rpc-response-shape'
import { isStaleRpcSocketEvent, logRpcSocketClose } from './rpc-socket-close-evidence'
import { describeSocketEvent, redactSocketEndpoint } from './socket-event-debug'
import type { ConnectionLogEmitter, ConnectionState, RpcResponse } from './types'
import { websocketPayloadToUint8 } from './websocket-payload-bytes'

const CONNECT_TIMEOUT_MS = 12_000
const HANDSHAKE_TIMEOUT_MS = 5_000
const WEBSOCKET_CONNECTING_STATE = 0

type SocketSessionOptions = {
  endpoint: string
  deviceToken: string
  serverPublicKey: Uint8Array
  getCurrentSocket: () => WebSocket | null
  getState: () => ConnectionState
  getReconnectAttempt: () => number
  isIntentionallyClosed: () => boolean
  emitLog: ConnectionLogEmitter
  onHandshakeStarted: () => void
  onAuthenticated: (session: RpcClientSocketSession) => void
  onAuthRejected: (reason: string) => void
  onRpcResponse: (response: RpcResponse) => void
  onBinary: (bytes: Uint8Array) => void
  onAnyInbound: (receivedAt: number) => void
  onAuthenticatedInbound: (session: RpcClientSocketSession) => void
  onClosed: (session: RpcClientSocketSession, closeCode?: number) => void
  onForcedClose: (session: RpcClientSocketSession) => void
}

export class RpcClientSocketSession {
  readonly socket: WebSocket
  readonly constructedAt = Date.now()
  private channel: MobileE2EEV2PhysicalChannel | null = null
  private authenticated = false
  private lastInboundAt: number | null = null
  private connectTimer: ReturnType<typeof setTimeout> | null = null
  private handshakeTimer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly options: SocketSessionOptions) {
    this.socket = new WebSocket(options.endpoint)
    this.attachHandlers()
    this.armConnectTimeout()
  }

  sendEncrypted(request: unknown): boolean {
    if (this.socket.readyState === WebSocket.OPEN && this.channel) {
      try {
        return this.channel.sendText(JSON.stringify(request))
      } catch {
        if (this.options.getCurrentSocket() === this.socket) {
          this.options.onForcedClose(this)
        }
        return false
      }
    }
    console.log('[net] sendEncrypted FAILED — channel not ready', {
      hasWs: this.options.getCurrentSocket() !== null,
      readyState: this.socket.readyState,
      hasKey: this.channel !== null,
      state: this.options.getState()
    })
    if (
      this.options.getState() === 'connected' &&
      this.options.getCurrentSocket() === this.socket &&
      this.socket.readyState !== WebSocket.OPEN
    ) {
      console.log('[net] sendEncrypted detected ws desync — forcing reconnect', {
        readyState: this.socket.readyState
      })
      this.options.onForcedClose(this)
    }
    return false
  }

  close(): void {
    this.socket.close()
  }

  clearTimers(): void {
    if (this.connectTimer) {
      clearTimeout(this.connectTimer)
      this.connectTimer = null
    }
    if (this.handshakeTimer) {
      clearTimeout(this.handshakeTimer)
      this.handshakeTimer = null
    }
  }

  clearKey(): void {
    this.channel?.dispose()
    this.channel = null
  }

  private attachHandlers(): void {
    this.socket.onopen = () => {
      if (this.isStale('open')) {
        return
      }
      console.log('[net] ws.onopen', { attempt: this.options.getReconnectAttempt() })
      this.clearConnectTimer()
      this.options.onHandshakeStarted()
      this.options.emitLog('success', 'WebSocket open', 'Starting E2EE handshake')
      try {
        this.channel = new MobileE2EEV2PhysicalChannel({
          session: MobileE2EEV2ClientSession.create({
            desktopPublicKeyB64: publicKeyToBase64(this.options.serverPublicKey),
            transport: 'direct'
          }),
          socket: this.socket,
          deviceToken: this.options.deviceToken,
          decodeBinary: websocketPayloadToUint8,
          onAuthenticated: () => {
            if (this.isStale('authenticated')) {
              return
            }
            this.clearHandshakeTimer()
            this.authenticated = true
            this.options.onAuthenticated(this)
          },
          onText: (plaintext) => {
            if (this.isStale('text')) {
              return
            }
            this.options.onAuthenticatedInbound(this)
            try {
              const response: unknown = JSON.parse(plaintext)
              if (isRpcResponse(response)) {
                this.options.onRpcResponse(response)
              }
            } catch {
              // Malformed application JSON is not an RPC response.
            }
          },
          onBinary: (bytes) => {
            if (this.isStale('binary')) {
              return
            }
            this.options.onAuthenticatedInbound(this)
            this.options.onBinary(bytes)
          },
          onError: (error) => {
            if (this.isStale('channel-error')) {
              return
            }
            this.clearHandshakeTimer()
            if (error instanceof MobileE2EEAuthenticationError) {
              this.options.onAuthRejected('Unauthorized — pairing may be revoked')
            } else {
              this.options.onForcedClose(this)
            }
          }
        })
        this.channel.start()
      } catch {
        this.options.onForcedClose(this)
        return
      }
      this.options.emitLog('info', 'Sent e2ee_hello', 'Awaiting server e2ee_ready')
      this.armHandshakeTimeout()
    }
    this.socket.onmessage = (event) => {
      if (!this.isStale('message')) {
        void this.handleMessage(event.data)
      }
    }
    this.socket.onclose = (event) => {
      const closeCode = logRpcSocketClose({
        event,
        state: this.options.getState(),
        attempt: this.options.getReconnectAttempt(),
        intentionallyClosed: this.options.isIntentionallyClosed(),
        endpoint: redactSocketEndpoint(this.options.endpoint),
        constructedAt: this.constructedAt,
        authenticated: this.authenticated,
        lastInboundAt: this.lastInboundAt
      })
      this.options.onClosed(this, closeCode)
    }
    this.socket.onerror = (event) => {
      if (this.isStale('error')) {
        return
      }
      const error = event as { message?: string } | undefined
      const description = describeSocketEvent(event)
      console.log('[net] ws.onerror', {
        message: error?.message,
        state: this.options.getState(),
        attempt: this.options.getReconnectAttempt(),
        eventKeys: description.keys,
        eventStr: description.json
      })
    }
  }

  private async handleMessage(rawData: unknown): Promise<void> {
    const receivedAt = Date.now()
    this.lastInboundAt = receivedAt
    this.options.onAnyInbound(receivedAt)
    await this.channel?.handleMessage(rawData)
  }

  private armConnectTimeout(): void {
    this.connectTimer = setTimeout(() => {
      this.connectTimer = null
      if (
        this.options.getCurrentSocket() === this.socket &&
        this.socket.readyState === WEBSOCKET_CONNECTING_STATE
      ) {
        console.log('[net] connect-timeout fired (onopen never arrived)', {
          attempt: this.options.getReconnectAttempt(),
          timeoutMs: CONNECT_TIMEOUT_MS
        })
        this.options.emitLog(
          'error',
          'WebSocket connect timeout',
          `No TCP/WS handshake within ${CONNECT_TIMEOUT_MS / 1000}s — endpoint unreachable?`,
          { code: 'connect-timeout' }
        )
        this.options.onForcedClose(this)
      }
    }, CONNECT_TIMEOUT_MS)
  }

  private armHandshakeTimeout(): void {
    this.handshakeTimer = setTimeout(() => {
      this.handshakeTimer = null
      if (this.options.getCurrentSocket() !== this.socket || this.authenticated) {
        return
      }
      console.log('[net] handshake-timeout fired (e2ee_authenticated never arrived)', {
        timeoutMs: HANDSHAKE_TIMEOUT_MS
      })
      this.options.emitLog(
        'error',
        'Handshake timeout',
        `No e2ee_ready/e2ee_authenticated within ${HANDSHAKE_TIMEOUT_MS / 1000}s`,
        { code: 'handshake-timeout' }
      )
      this.options.onForcedClose(this)
    }, HANDSHAKE_TIMEOUT_MS)
  }

  private clearConnectTimer(): void {
    if (this.connectTimer) {
      clearTimeout(this.connectTimer)
      this.connectTimer = null
    }
  }

  private clearHandshakeTimer(): void {
    if (this.handshakeTimer) {
      clearTimeout(this.handshakeTimer)
      this.handshakeTimer = null
    }
  }

  private isStale(eventName: string): boolean {
    return isStaleRpcSocketEvent(
      this.options.getCurrentSocket(),
      this.socket,
      eventName,
      this.options.getState(),
      this.options.getReconnectAttempt()
    )
  }
}
