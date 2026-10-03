import type { HiveAccountRelayChannel } from './hive-account-relay-channel'
import { RemoteRuntimeClientError } from './remote-runtime-client-error'
import { serializeRemoteRuntimePayload } from './remote-runtime-memory-limits'
import { toHiveAccountRelayClientError } from './hive-account-relay-errors'
import {
  createHiveAccountRelayDeadline,
  waitForHiveAccountRelayDeadline
} from './hive-account-relay-deadline'
import {
  publishHiveAccountRelayConsumers,
  type HiveAccountRelayCallbacks,
  type HiveAccountRelayStream as Stream
} from './hive-account-relay-pool-contract'
const MAX_CONSUMERS = 64
const unavailable = () =>
  new RemoteRuntimeClientError('remote_runtime_unavailable', 'Relay connection unavailable')
export class HiveAccountRelayStreams {
  private streams = new Map<string, Stream>()
  private consumers = 0
  private keyBytes = 0
  constructor(
    private readonly options: {
      openChannel: () => Promise<HiveAccountRelayChannel>
      nextId: () => string
      isClosed: () => boolean
    }
  ) {}
  clear(): void {
    this.streams.clear()
    this.keyBytes = 0
  }
  async subscribe(
    method: string,
    params: unknown,
    callbacks: HiveAccountRelayCallbacks,
    timeoutMs: number
  ) {
    const deadline = createHiveAccountRelayDeadline(timeoutMs)
    if (this.options.isClosed() || this.consumers >= MAX_CONSUMERS) {
      throw unavailable()
    }
    const key = serializeRemoteRuntimePayload([method, params])
    let stream = this.streams.get(key)
    const bytes = new TextEncoder().encode(key).byteLength
    if (!stream && this.keyBytes + bytes > 16 * 1024 * 1024) {
      throw unavailable()
    }
    this.consumers++
    if (!stream) {
      const consumers = new Set<HiveAccountRelayCallbacks>()
      stream = { consumers, channel: this.options.openChannel() }
      this.streams.set(key, stream)
      this.keyBytes += bytes
      const current = stream
      void stream.channel
        .then((channel) => {
          // Every consumer can time out while the shared connection is still opening. Do not send
          // the abandoned stream request when that connection eventually succeeds.
          if (
            this.streams.get(key) !== current ||
            consumers.size === 0 ||
            channel.isClosed ||
            this.options.isClosed()
          ) {
            channel.close()
            return
          }
          channel.subscribe(
            { id: this.options.nextId(), method, params },
            {
              onResponse: (response) =>
                publishHiveAccountRelayConsumers(consumers, (listener) =>
                  listener.onResponse(response)
                ),
              onBinary: (bytes) =>
                publishHiveAccountRelayConsumers(consumers, (listener) =>
                  listener.onBinary?.(bytes)
                ),
              onClose: () => {
                if (this.streams.get(key) === current) {
                  this.streams.delete(key)
                  this.keyBytes -= bytes
                }
                publishHiveAccountRelayConsumers(consumers, (listener) => listener.onClose?.())
              }
            }
          )
        })
        .catch((error: unknown) => {
          if (this.streams.get(key) === current) {
            this.streams.delete(key)
            this.keyBytes -= bytes
          }
          publishHiveAccountRelayConsumers(consumers, (listener) =>
            listener.onError?.(toHiveAccountRelayClientError(error))
          )
        })
    }
    const current = stream
    let released = false
    const release = () => {
      if (released) {
        return
      }
      released = true
      this.consumers--
      current.consumers.delete(consumer)
      if (current.consumers.size === 0) {
        if (this.streams.get(key) === current) {
          this.streams.delete(key)
          this.keyBytes -= bytes
        }
        void current.channel.then((channel) => channel.close()).catch(() => undefined)
      }
    }
    const consumer: HiveAccountRelayCallbacks = {
      ...callbacks,
      onClose: () => {
        if (released) {
          return
        }
        release()
        callbacks.onClose?.()
      },
      onError: (error) => {
        if (released) {
          return
        }
        release()
        callbacks.onError?.(error)
      }
    }
    current.consumers.add(consumer)
    try {
      const channel = await waitForHiveAccountRelayDeadline(current.channel, deadline)
      if (channel.isClosed || this.options.isClosed()) {
        throw unavailable()
      }
      return {
        close: release,
        sendBinary: (bytes: Uint8Array) => !released && channel.sendBinary(bytes),
        sendRequest: (name: string, args: unknown, timeout?: number | { timeoutMs?: number }) =>
          released
            ? Promise.reject(unavailable())
            : channel.request(
                { id: this.options.nextId(), method: name, params: args },
                typeof timeout === 'number' ? timeout : timeout?.timeoutMs
              )
      }
    } catch (error) {
      const clientError = toHiveAccountRelayClientError(error)
      publishHiveAccountRelayConsumers(new Set([consumer]), (listener) =>
        listener.onError?.(clientError)
      )
      release()
      throw clientError
    }
  }
}
