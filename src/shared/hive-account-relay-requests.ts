import { RemoteRuntimeClientError } from './remote-runtime-client-error'
import type { RuntimeRpcResponse } from './runtime-rpc-envelope'

type PendingRequest = {
  resolve: (response: RuntimeRpcResponse<unknown>) => void
  reject: (error: unknown) => void
  cleanup: () => void
}

export class HiveAccountRelayRequests {
  private pending = new Map<string, PendingRequest>()
  get size(): number {
    return this.pending.size
  }
  has(id: string): boolean {
    return this.pending.has(id)
  }

  request(
    id: string,
    timeoutMs: number,
    send: () => void,
    signal?: AbortSignal
  ): Promise<RuntimeRpcResponse<unknown>> {
    if (signal?.aborted) {
      return Promise.reject(signal.reason)
    }
    return new Promise((resolve, reject) => {
      const release = (): void => {
        this.pending.delete(id)
        pending.cleanup()
      }
      const abort = (): void => {
        release()
        reject(signal?.reason)
      }
      const timer = setTimeout(
        () => {
          release()
          reject(new RemoteRuntimeClientError('runtime_timeout', 'Runtime request timed out'))
        },
        Math.max(1, Math.min(timeoutMs, 300_000))
      )
      const pending: PendingRequest = {
        resolve,
        reject,
        cleanup: () => {
          clearTimeout(timer)
          signal?.removeEventListener('abort', abort)
        }
      }
      this.pending.set(id, pending)
      signal?.addEventListener('abort', abort, { once: true })
      send()
    })
  }

  resolve(response: RuntimeRpcResponse<unknown>): void {
    const pending = this.pending.get(response.id)
    if (!pending) {
      return
    }
    this.pending.delete(response.id)
    pending.cleanup()
    pending.resolve(response)
  }

  rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.cleanup()
      pending.reject(error)
    }
    this.pending.clear()
  }
}
