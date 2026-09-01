import { randomUUID } from 'node:crypto'
import { REMOTE_RUNTIME_MAX_SUBSCRIPTIONS } from '../../shared/remote-runtime-memory-limits'
import { RemoteRuntimeClientError } from '../../shared/remote-runtime-client-error'
import {
  prepareRemoteRuntimeRequest,
  releaseRemoteRuntimePreparedRequest,
  takeRemoteRuntimePreparedRequest,
  type RemoteRuntimePreparedRequest
} from '../../shared/remote-runtime-prepared-request-admission'
import type { RuntimeRpcResponse } from '../../shared/runtime-rpc-envelope'
import { asRelayError } from './hive-account-runtime-relay-protocol'

type PendingRequest = {
  resolve: (response: RuntimeRpcResponse<unknown>) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
  cancelSend: () => boolean
  preparedRequest: RemoteRuntimePreparedRequest | null
}

export type RelaySubscriptionCallbacks = {
  onResponse: (response: RuntimeRpcResponse<unknown>) => void
  onBinary?: (bytes: Uint8Array<ArrayBufferLike>) => void
  onError: (error: RemoteRuntimeClientError) => void
  onClose?: () => void
}

type RetainedSubscription = {
  callbacks: RelaySubscriptionCallbacks
  closed: boolean
}

export class HiveAccountRuntimeRelayRequests {
  private readonly pending = new Map<string, PendingRequest>()
  private readonly subscriptions = new Map<string, RetainedSubscription>()
  private closeNotified = false

  request<TResult>(
    timeoutMs: number,
    serialize: (requestId: string) => string,
    send: (serializedRequest: string) => void | { cancel: () => boolean }
  ): Promise<RuntimeRpcResponse<TResult>> {
    const id = randomUUID()
    return new Promise<RuntimeRpcResponse<TResult>>((resolve, reject) => {
      let preparedRequest: RemoteRuntimePreparedRequest
      try {
        preparedRequest = prepareRemoteRuntimeRequest(this.pending, () => serialize(id))
      } catch (error) {
        reject(asRelayError(error))
        return
      }
      let pending: PendingRequest
      const timer = setTimeout(() => {
        this.pending.delete(id)
        pending.cancelSend()
        releaseRemoteRuntimePreparedRequest(pending)
        reject(new RemoteRuntimeClientError('runtime_timeout', 'Cloud Runtime request timed out.'))
      }, timeoutMs)
      pending = {
        resolve: resolve as (response: RuntimeRpcResponse<unknown>) => void,
        reject,
        timer,
        cancelSend: () => false,
        preparedRequest
      }
      this.pending.set(id, pending)
      try {
        const serializedRequest = takeRemoteRuntimePreparedRequest(pending)
        if (serializedRequest === null) {
          throw new Error('Cloud Runtime request serialization was unavailable.')
        }
        pending.cancelSend = send(serializedRequest)?.cancel ?? (() => false)
      } catch (error) {
        clearTimeout(timer)
        this.pending.delete(id)
        releaseRemoteRuntimePreparedRequest(pending)
        reject(asRelayError(error))
      }
    })
  }

  subscribe(callbacks: RelaySubscriptionCallbacks, send: (requestId: string) => void): string {
    if (this.subscriptions.size >= REMOTE_RUNTIME_MAX_SUBSCRIPTIONS) {
      throw new RemoteRuntimeClientError(
        'remote_runtime_busy',
        'Cloud Runtime subscription limit reached.'
      )
    }
    const requestId = randomUUID()
    this.subscriptions.set(requestId, { callbacks, closed: false })
    try {
      send(requestId)
    } catch (error) {
      this.subscriptions.delete(requestId)
      throw error
    }
    return requestId
  }

  removeSubscription(requestId: string): void {
    const retained = this.subscriptions.get(requestId)
    if (retained) {
      retained.closed = true
      this.subscriptions.delete(requestId)
    }
  }

  dispatchResponse(response: RuntimeRpcResponse<unknown>): void {
    const pending = this.pending.get(response.id)
    if (pending) {
      clearTimeout(pending.timer)
      this.pending.delete(response.id)
      releaseRemoteRuntimePreparedRequest(pending)
      pending.resolve(response)
      return
    }
    const subscription = this.subscriptions.get(response.id)
    if (subscription && !subscription.closed) {
      subscription.callbacks.onResponse(response)
    }
  }

  dispatchBinary(bytes: Uint8Array<ArrayBufferLike>): void {
    for (const subscription of this.subscriptions.values()) {
      if (!subscription.closed) {
        subscription.callbacks.onBinary?.(bytes)
      }
    }
  }

  rejectAll(error: Error): void {
    for (const request of this.pending.values()) {
      clearTimeout(request.timer)
      request.cancelSend()
      releaseRemoteRuntimePreparedRequest(request)
      request.reject(error)
    }
    this.pending.clear()
  }

  notifyError(error: RemoteRuntimeClientError): void {
    for (const subscription of this.subscriptions.values()) {
      if (!subscription.closed) {
        subscription.closed = true
        subscription.callbacks.onError(error)
      }
    }
    this.notifyClosed()
  }

  notifyClosed(): void {
    if (this.closeNotified) {
      return
    }
    this.closeNotified = true
    for (const subscription of this.subscriptions.values()) {
      subscription.callbacks.onClose?.()
    }
    this.subscriptions.clear()
  }
}
