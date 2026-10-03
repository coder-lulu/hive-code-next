import type { WebSocket } from 'ws'
import type { E2EEChannel } from '../rpc/e2ee-channel'
import type { RpcRequest } from '../rpc/core'
import { fingerprintAuthenticatedPairingCredential } from '../rpc/orchestration-mutation-executor'
import { RuntimeRpcCloudDispatch, LOCAL_ONLY_RPC_METHODS } from './runtime-rpc-cloud-dispatch'
import { classifyRuntimeLongPoll } from './runtime-rpc-long-poll'
import { z } from 'zod'
import { parseStrictJson } from '../../hive-runtime-cloud/relay-host/hive-runtime-relay-protocol'
import {
  REMOTE_RUNTIME_MAX_OUTBOUND_JSON_BYTES,
  REMOTE_RUNTIME_MAX_PROCESS_PENDING_REQUESTS,
  REMOTE_RUNTIME_MAX_PROCESS_PENDING_RPC_BYTES
} from '../../../shared/remote-runtime-memory-limits'

export type RuntimeRpcAccountConnection = {
  ws: WebSocket
  channel: E2EEChannel
  connectionId: string
  runtimeSessionId: string
  operationCallerKey: string
  revalidate: (touch?: boolean) => boolean
}

const ACCOUNT_TERMINAL_CLIENT_METHODS = new Set([
  'terminal.subscribe',
  'terminal.send',
  'terminal.updateViewport',
  'terminal.setDisplayMode',
  'terminal.unsubscribe'
])

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/** Account authorization never enters DeviceRegistry or the paired-device dispatcher. */
export class RuntimeRpcAccountDispatch extends RuntimeRpcCloudDispatch {
  private accountPendingBytes = 0
  private accountPendingRequests = 0

  attachAccountRuntimeConnection(connection: RuntimeRpcAccountConnection): () => void {
    let closed = false
    let pending = 0
    const current = (touch = false) => !closed && connection.revalidate(touch)
    connection.channel.onMessage((raw, reply, binary) => {
      if (!current(true)) {
        return
      }
      const bytes = Buffer.byteLength(raw, 'utf8')
      if (
        pending >= 128 ||
        bytes > REMOTE_RUNTIME_MAX_OUTBOUND_JSON_BYTES ||
        this.accountPendingRequests >= REMOTE_RUNTIME_MAX_PROCESS_PENDING_REQUESTS ||
        this.accountPendingBytes + bytes > REMOTE_RUNTIME_MAX_PROCESS_PENDING_RPC_BYTES
      ) {
        reply(
          JSON.stringify(
            this.buildError('unknown', 'runtime_busy', 'Connection request limit reached')
          )
        )
        return
      }
      pending++
      this.accountPendingBytes += bytes
      this.accountPendingRequests++
      void this.dispatchAccountRuntimeMessage(
        connection,
        raw,
        (response) => {
          if (current()) {
            reply(response)
          }
        },
        (bytes) => (current() ? binary(bytes) : false),
        current
      )
        .catch(() => {
          if (current()) {
            reply(JSON.stringify(this.buildError('unknown', 'internal_error', 'Request failed')))
          }
        })
        .finally(() => {
          pending--
          this.accountPendingBytes -= bytes
          this.accountPendingRequests--
        })
    })
    connection.channel.onBinaryMessage((bytes) => {
      if (current(true)) {
        this.binaryMessageRouter.dispatch(connection.connectionId, bytes)
      }
    })
    this.runtime.activateRecentPtyPathCandidateTracking?.()
    return () => {
      if (closed) {
        return
      }
      closed = true
      this.abortWebSocketDispatches(connection.ws)
      try {
        this.runtime.cleanupSubscriptionsForConnection(connection.connectionId)
      } finally {
        try {
          this.runtime.cancelMobileDictationForConnection(connection.connectionId)
        } finally {
          this.binaryMessageRouter.deleteConnection(connection.connectionId)
        }
      }
    }
  }

  private async dispatchAccountRuntimeMessage(
    socket: RuntimeRpcAccountConnection,
    raw: string,
    reply: (value: string) => void,
    sendBinary: (bytes: Uint8Array<ArrayBufferLike>) => boolean | void,
    current: () => boolean
  ): Promise<void> {
    let request: RpcRequest
    try {
      request = parseStrictJson(raw, z.record(z.string(), z.unknown())) as RpcRequest
    } catch {
      return
    }
    if (
      !request ||
      typeof request !== 'object' ||
      Array.isArray(request) ||
      typeof request.id !== 'string' ||
      !request.id ||
      typeof request.method !== 'string' ||
      !request.method
    ) {
      return
    }
    if (
      ['deviceToken', 'sessionToken', 'authToken', 'ticketSecret', 'principalKind'].some((field) =>
        Object.hasOwn(request, field)
      )
    ) {
      reply(
        JSON.stringify(
          this.buildError(request.id, 'unauthorized', 'Authentication is bound to the connection')
        )
      )
      return
    }
    if (!current()) {
      return
    }
    if (LOCAL_ONLY_RPC_METHODS.has(request.method) || request.method.startsWith('pairing.')) {
      reply(
        JSON.stringify(this.buildError(request.id, 'forbidden', 'Method requires a local client'))
      )
      return
    }
    const clientId = `account-runtime:${socket.runtimeSessionId}`
    // Terminal ownership follows the authenticated physical session, never a
    // caller-supplied ID. Leave all other fields for the existing method schema.
    if (record(request.params)) {
      const params = request.params
      if (ACCOUNT_TERMINAL_CLIENT_METHODS.has(request.method) && params.client !== undefined) {
        if (
          !record(params.client) ||
          typeof params.client.id !== 'string' ||
          !params.client.id.trim()
        ) {
          reply(
            JSON.stringify(
              this.buildError(request.id, 'invalid_argument', 'Invalid terminal client')
            )
          )
          return
        }
        const boundParams: Record<string, unknown> = {
          ...params,
          client: { ...params.client, id: clientId }
        }
        if (
          request.method === 'terminal.unsubscribe' &&
          typeof params.subscriptionId === 'string' &&
          params.subscriptionId.endsWith(`:${params.client.id}`)
        ) {
          boundParams.subscriptionId =
            params.subscriptionId.slice(0, -params.client.id.length) + clientId
        }
        request = { ...request, params: boundParams }
      } else if (request.method === 'terminal.resizeForClient') {
        if (typeof params.clientId !== 'string' || !params.clientId.trim()) {
          reply(
            JSON.stringify(
              this.buildError(request.id, 'invalid_argument', 'Invalid terminal client')
            )
          )
          return
        }
        request = { ...request, params: { ...params, clientId } }
      }
    }
    const longPoll = classifyRuntimeLongPoll(request)
    const rejection = this.admitLongPoll(longPoll, clientId)
    if (rejection) {
      reply(JSON.stringify(this.buildError(request.id, 'runtime_busy', rejection)))
      return
    }
    const abort = this.registerWebSocketDispatchAbort(socket.ws)
    try {
      await this.dispatcher.dispatchStreaming(request, reply, {
        authorizeRequest: (method) =>
          current() && !LOCAL_ONLY_RPC_METHODS.has(method) && !method.startsWith('pairing.'),
        authenticatedCallerFingerprint: fingerprintAuthenticatedPairingCredential(clientId),
        connectionId: socket.connectionId,
        clientId,
        authenticatedAccountRuntimeSessionId: socket.runtimeSessionId,
        authenticatedAccountOperationCallerKey: socket.operationCallerKey,
        clientKind: 'runtime',
        clientCapabilities: socket.channel.clientCapabilities,
        signal: abort.signal,
        sendBinary,
        registerBinaryStreamHandler: (streamId, handler) =>
          current()
            ? this.registerBinaryStreamHandler(socket.connectionId, streamId, handler)
            : () => {},
        registerBinaryMessageHandler: (handler) =>
          current() ? this.registerBinaryMessageHandler(socket.connectionId, handler) : () => {}
      })
    } finally {
      abort.dispose()
      this.releaseLongPoll(longPoll, clientId)
    }
  }
}
