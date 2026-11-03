import type { HiveAccountRelayChannel } from './hive-account-relay-channel'
import { RemoteRuntimeClientError } from './remote-runtime/remote-runtime-client-error'
import type { RuntimeRpcResponse } from './runtime-rpc-envelope'

export class HiveAccountRelayStatusReceipt {
  private channel: HiveAccountRelayChannel | null = null
  epoch = 0

  get readyChannel(): HiveAccountRelayChannel | null {
    return this.channel?.isReady ? this.channel : null
  }

  async request(
    channel: HiveAccountRelayChannel,
    id: string,
    timeoutMs: number,
    signal?: AbortSignal
  ): Promise<RuntimeRpcResponse<unknown>> {
    const response = await channel.request({ id, method: 'status.get' }, timeoutMs, signal)
    signal?.throwIfAborted()
    if (!channel.isReady) {
      throw new RemoteRuntimeClientError(
        'remote_runtime_unavailable',
        'Relay connection unavailable'
      )
    }
    if (response.ok) {
      this.accept(channel)
    }
    return response
  }

  private accept(channel: HiveAccountRelayChannel): void {
    if (this.channel !== channel) {
      this.channel = channel
      this.epoch++
    }
  }

  release(channel: HiveAccountRelayChannel): boolean {
    if (this.channel !== channel) {
      return false
    }
    this.channel = null
    this.epoch++
    return true
  }

  require(epoch: number): HiveAccountRelayChannel {
    const channel = this.readyChannel
    if (epoch !== this.epoch || !channel) {
      throw new RemoteRuntimeClientError(
        'remote_runtime_unavailable',
        'Relay connection unavailable'
      )
    }
    return channel
  }
}
