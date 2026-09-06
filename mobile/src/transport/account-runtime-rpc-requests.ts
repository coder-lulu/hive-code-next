import type { HiveAccountRelayPool } from '../../../src/shared/hive-account-relay-pool'
import { serializeRemoteRuntimePayload } from '../../../src/shared/remote-runtime-memory-limits'
import type { AccountRuntimeStream } from './account-runtime-rpc-stream'
import type { RpcResponse } from './types'

const TERMINAL_CHANNEL_METHODS = new Set([
  'terminal.send',
  'terminal.resizeForClient',
  'terminal.focus',
  'terminal.setDisplayMode',
  'terminal.updateViewport',
  'terminal.restoreFit',
  'terminal.unsubscribe'
])

function terminalStreamMatches(stream: AccountRuntimeStream, method: string, params: unknown) {
  if (stream.method !== 'terminal.subscribe' || !TERMINAL_CHANNEL_METHODS.has(method)) {
    return false
  }
  if (
    !params ||
    typeof params !== 'object' ||
    !stream.params ||
    typeof stream.params !== 'object'
  ) {
    return false
  }
  const target = params as { terminal?: unknown; subscriptionId?: unknown }
  const source = stream.params as { terminal?: unknown; client?: { id?: unknown } }
  if (typeof source.terminal !== 'string') {
    return false
  }
  return method === 'terminal.unsubscribe'
    ? target.subscriptionId === source.terminal ||
        target.subscriptionId === `${source.terminal}:${source.client?.id}`
    : target.terminal === source.terminal
}

/** Requests retain their original channel ownership; writes are never replayed. */
export class AccountRuntimeRpcRequests {
  private active = 0
  private bytes = 0

  async request(
    pool: HiveAccountRelayPool,
    streams: Iterable<AccountRuntimeStream>,
    method: string,
    params: unknown,
    timeoutMs = 30_000
  ): Promise<RpcResponse> {
    if (this.active >= 64) {
      throw new Error('Account Runtime pending request limit reached')
    }
    const bytes = new TextEncoder().encode(
      serializeRemoteRuntimePayload({ method, params })
    ).byteLength
    if (this.bytes + bytes > 16 * 1024 * 1024) {
      throw new Error('Account Runtime pending request byte limit reached')
    }
    const stream = [...streams].find((candidate) =>
      terminalStreamMatches(candidate, method, params)
    )
    const queryReply =
      method === 'terminal.send' &&
      params &&
      typeof params === 'object' &&
      'inputKind' in params &&
      params.inputKind === 'query-reply'
    if ((stream && !stream.physical) || (!stream && queryReply)) {
      throw new Error('Account terminal subscription is unavailable')
    }
    const physical = stream?.physical
    const generation = stream?.generation
    this.active++
    this.bytes += bytes
    try {
      const response = await (physical
        ? physical.sendRequest(method, params, timeoutMs)
        : pool.request(method, params, timeoutMs))
      if (stream && (stream.physical !== physical || stream.generation !== generation)) {
        throw new Error('Account terminal subscription changed during request')
      }
      const runtimeId = response._meta?.runtimeId
      if (typeof runtimeId !== 'string' || !runtimeId) {
        throw new Error('Account Runtime response identity is missing')
      }
      return { ...response, _meta: { runtimeId } }
    } finally {
      this.active--
      this.bytes -= bytes
    }
  }
}
