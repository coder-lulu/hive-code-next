import type { HiveAccountRelayPool } from '../../../src/shared/hive-account-relay-pool'
import { decodeBrowserScreencastFrame } from './browser-screencast-protocol'
import type { RpcClient } from './rpc-client'
import { RpcClientTerminalStreamRouter } from './rpc-client-terminal-stream-router'
import { isTerminalSubscribedResult } from './rpc-subscription-result-shapes'

export type AccountRuntimeStream = {
  method: string
  params: unknown
  listener: Parameters<RpcClient['subscribe']>[2]
  options: Parameters<RpcClient['subscribe']>[3]
  physical: { close(): void } | null
  generation: number
}

export function attachAccountRuntimeStream(
  stream: AccountRuntimeStream,
  pool: HiveAccountRelayPool,
  lifecycle: {
    current(): boolean
    onInbound(): void
    onEnded(): void
    onClosed(error: unknown): void
  }
): void {
  const router = new RpcClientTerminalStreamRouter()
  const { current } = lifecycle
  void pool
    .subscribe(stream.method, stream.params, {
      onResponse: (response) => {
        if (!current()) {
          return
        }
        lifecycle.onInbound()
        if (!response.ok) {
          lifecycle.onEnded()
          stream.listener({ type: 'error', message: response.error.message, error: response.error })
          return
        }
        if (isTerminalSubscribedResult(response.result)) {
          router.register(response.id, response.result.streamId, stream.listener)
        }
        stream.listener(response.result)
        if (
          response.result &&
          typeof response.result === 'object' &&
          'type' in response.result &&
          response.result.type === 'end'
        ) {
          lifecycle.onEnded()
        }
      },
      onBinary: (bytes) => {
        if (!current()) {
          return
        }
        lifecycle.onInbound()
        const frame = decodeBrowserScreencastFrame(bytes)
        if (frame) {
          stream.options?.onBinaryFrame?.(frame)
        } else {
          router.handle(bytes)
        }
      },
      onError: (error) => {
        if (current()) {
          lifecycle.onClosed(error)
        }
      },
      onClose: () => {
        if (current()) {
          lifecycle.onClosed(pool.getLastError())
        }
      }
    })
    .then((physical) => {
      if (current()) {
        stream.physical = physical
      } else {
        physical.close()
      }
    })
    .catch((error: unknown) => {
      if (current()) {
        lifecycle.onClosed(error)
      }
    })
}
