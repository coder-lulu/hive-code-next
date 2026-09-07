import { HiveAccountRelayStreams } from './hive-account-relay-streams'
import { HiveAccountRelayChannel, type HiveAccountRelaySocket } from './hive-account-relay-channel'
import {
  disposeHiveAccountRelayMaterial,
  type HiveAccountRelayMaterial
} from './hive-account-relay-material'
import type { RuntimeOrchestrationEnvelope, RuntimeRpcResponse } from './runtime-rpc-envelope'
import { RemoteRuntimeClientError } from './remote-runtime-client-error'
import type { RuntimeCapability } from './protocol-version'
import { serializeRemoteRuntimePayload } from './remote-runtime-memory-limits'
import { classifyHiveAccountRelayError } from './hive-account-relay-errors'

import type {
  HiveAccountRelayPoolState,
  HiveAccountRelayCallbacks
} from './hive-account-relay-pool-contract'
export type {
  HiveAccountRelayPoolState,
  HiveAccountRelayCallbacks
} from './hive-account-relay-pool-contract'
const MAX_CHANNELS = 8
const unavailable = () =>
  new RemoteRuntimeClientError('remote_runtime_unavailable', 'Relay connection unavailable')

/** One account/session/runtime scope. Non-cancellable streams use bounded independent slots. */
export class HiveAccountRelayPool {
  private state: HiveAccountRelayPoolState = 'idle'
  private channels = new Set<HiveAccountRelayChannel>()
  private streams = new HiveAccountRelayStreams({
    openChannel: () => this.openChannel(),
    nextId: () => this.nextId(),
    isClosed: () => this.state === 'closed'
  })
  private main: Promise<HiveAccountRelayChannel> | null = null
  private pending = 0
  private sequence = 0
  private activeRequests = 0
  private requestBytes = 0
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  private acquisition: Promise<unknown> = Promise.resolve()
  private binding: string | null = null
  private lastError: unknown = null
  private nextAttemptAt = 0
  private retryAttempt = 0

  constructor(
    private readonly options: {
      createMaterial: () => Promise<HiveAccountRelayMaterial>
      createSocket: (url: string) => HiveAccountRelaySocket
      clientCapabilities?: readonly RuntimeCapability[]
      randomBytes?: (length: number) => Uint8Array
      onStateChange?: (state: HiveAccountRelayPoolState) => void
    }
  ) {}

  getState = (): HiveAccountRelayPoolState => this.state
  getLastError = (): unknown => this.lastError
  async connect(): Promise<void> {
    await this.getMain()
  }

  async request(
    method: string,
    params: unknown,
    timeoutMs = 30_000,
    envelope?: RuntimeOrchestrationEnvelope
  ): Promise<RuntimeRpcResponse<unknown>> {
    if (this.activeRequests >= 64) {
      throw unavailable()
    }
    const payloadBytes = new TextEncoder().encode(
      serializeRemoteRuntimePayload({ method, params, ...envelope })
    ).byteLength
    if (this.requestBytes + payloadBytes > 16 * 1024 * 1024) {
      throw unavailable()
    }
    this.requestBytes += payloadBytes
    this.activeRequests++
    this.clearIdle()
    try {
      const channel = await this.getMain()
      return await channel.request({ ...envelope, id: this.nextId(), method, params }, timeoutMs)
    } finally {
      this.activeRequests--
      this.requestBytes -= payloadBytes
      this.scheduleIdle()
    }
  }

  subscribe(method: string, params: unknown, callbacks: HiveAccountRelayCallbacks) {
    return this.streams.subscribe(method, params, callbacks)
  }

  close(): void {
    if (this.state === 'closed') {
      return
    }
    this.setState('closed')
    this.clearIdle()
    for (const channel of this.channels) {
      channel.close()
    }
    this.channels.clear()
    this.streams.clear()
    this.main = null
  }

  private getMain(): Promise<HiveAccountRelayChannel> {
    if (this.state === 'closed') {
      return Promise.reject(unavailable())
    }
    this.clearIdle()
    if (!this.main) {
      this.setState('connecting')
      const flight = this.openChannel()
        .then((channel) => {
          if (this.getState() === 'closed' || channel.isClosed) {
            throw unavailable()
          }
          this.setState('ready')
          this.scheduleIdle()
          return channel
        })
        .catch((error: unknown) => {
          if (this.main === flight) {
            this.main = null
          }
          if (this.state !== 'closed') {
            this.setState('idle')
          }
          throw error
        })
      this.main = flight
    }
    return this.main
  }

  private async openChannel(): Promise<HiveAccountRelayChannel> {
    if (this.state === 'closed' || this.channels.size + this.pending >= MAX_CHANNELS) {
      throw unavailable()
    }
    if (
      this.lastError &&
      (!classifyHiveAccountRelayError(this.lastError).retryable || Date.now() < this.nextAttemptAt)
    ) {
      throw this.lastError
    }
    this.pending++
    const acquired = this.acquisition.then(() => {
      if (this.state === 'closed') {
        throw unavailable()
      }
      if (
        this.lastError &&
        (!classifyHiveAccountRelayError(this.lastError).retryable ||
          Date.now() < this.nextAttemptAt)
      ) {
        throw this.lastError
      }
      return this.options.createMaterial()
    })
    this.acquisition = acquired.catch((error: unknown) => this.recordFailure(error))
    try {
      const material = await acquired
      if (this.getState() === 'closed') {
        disposeHiveAccountRelayMaterial(material)
        throw unavailable()
      }
      const binding = JSON.stringify([
        material.outer.cellId,
        material.outer.cellIncarnationId,
        material.outer.assignmentId,
        material.outer.assignmentEpoch
      ])
      if (this.binding && this.binding !== binding) {
        for (const channel of this.channels) {
          channel.close()
        }
        this.main = null
      }
      if (this.getState() === 'closed') {
        disposeHiveAccountRelayMaterial(material)
        throw unavailable()
      }
      this.binding = binding
      let connected = false
      const channel = new HiveAccountRelayChannel({
        material,
        createSocket: this.options.createSocket,
        clientCapabilities: this.options.clientCapabilities,
        randomBytes: this.options.randomBytes,
        onClosed: (error, intentional) => {
          // Handshake failures are recorded once by the awaiting catch below.
          if (this.state !== 'closed' && !intentional && connected) {
            this.recordFailure(error)
          }
          this.channels.delete(channel)
          const flight = this.main
          void flight
            ?.then((main) => {
              if (main === channel && this.main === flight) {
                this.main = null
              }
            })
            .catch(() => undefined)
          if (this.state !== 'closed') {
            this.setState(this.hasReadyChannel() ? 'ready' : 'idle')
          }
        }
      })
      this.channels.add(channel)
      await channel.connect()
      connected = true
      this.lastError = null
      this.retryAttempt = 0
      this.nextAttemptAt = 0
      if (this.getState() !== 'closed') {
        this.setState('ready')
      }
      return channel
    } catch (error) {
      this.recordFailure(error)
      throw error
    } finally {
      this.pending--
    }
  }

  private nextId = (): string => `relay-${++this.sequence}`
  private recordFailure(error: unknown): void {
    if (this.lastError === error) {
      return
    }
    this.lastError = error
    this.nextAttemptAt =
      Date.now() + classifyHiveAccountRelayError(error, this.retryAttempt++).retryDelayMs
  }
  private setState(state: HiveAccountRelayPoolState): void {
    this.state = state
    this.options.onStateChange?.(state)
  }
  private clearIdle(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
  }
  private scheduleIdle(): void {
    if (this.activeRequests || this.state === 'closed') {
      return
    }
    this.clearIdle()
    this.idleTimer = setTimeout(() => {
      const main = this.main
      this.main = null
      void main?.then((channel) => channel.close()).catch(() => undefined)
      if (this.state !== 'closed') {
        this.setState(this.hasReadyChannel() ? 'ready' : 'idle')
      }
    }, 30_000)
  }
  private hasReadyChannel(): boolean {
    return [...this.channels].some((channel) => channel.isReady)
  }
}
