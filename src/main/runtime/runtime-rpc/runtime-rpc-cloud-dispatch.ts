import type { WebSocket } from 'ws'
import type { RpcRequest } from '../rpc/core'
import type { AuthenticatedCloudManagedSocket } from '../rpc/mobile-socket-wiring'
import { fingerprintAuthenticatedPairingCredential } from '../rpc/orchestration-mutation-executor'
import { RuntimeRpcRequestAdmission } from './runtime-rpc-request-admission'
import { classifyRuntimeLongPoll } from './runtime-rpc-long-poll'
import { HiveRuntimeDisplayMetadataError } from '../../hive-runtime-cloud/hive-runtime-cloud-display-metadata-service'

// Cloud ownership changes are available only through the local authenticated metadata transport.
export const LOCAL_ONLY_RPC_METHODS = new Set([
  'cloudRuntime.status',
  'cloudRuntime.claim',
  'cloudRuntime.claimPoll',
  'cloudRuntime.resetIdentity'
])

export class RuntimeRpcCloudDispatch extends RuntimeRpcRequestAdmission {
  private readonly cloudSessionExpiryTimers = new Map<WebSocket, ReturnType<typeof setTimeout>>()

  protected revalidateCloudSession(socket: AuthenticatedCloudManagedSocket): boolean {
    let current = false
    try {
      current = this.cloudWebLaunchService?.revalidateSession(socket.principal) === true
    } catch {
      // Authorization failures must also close existing streams, not just refuse the next RPC.
    }
    if (!current) {
      this.mobileSocketWiring?.terminateCloudSessionConnections(
        socket.principal.managedWebSessionId
      )
    }
    return current
  }

  protected handleCloudManagedWebSocketBinary(
    socket: AuthenticatedCloudManagedSocket,
    bytes: Uint8Array<ArrayBufferLike>
  ): void {
    if (this.revalidateCloudSession(socket)) {
      this.handleWebSocketBinaryMessage(bytes, socket.ws)
    }
  }

  protected handleCloudSocketReady(socket: AuthenticatedCloudManagedSocket): void {
    this.scheduleCloudSessionExpiry(socket)
    this.runtime.activateRecentPtyPathCandidateTracking?.()
  }

  private scheduleCloudSessionExpiry(socket: AuthenticatedCloudManagedSocket): void {
    const remaining = socket.principal.expiresAt - Date.now()
    if (!Number.isFinite(remaining) || remaining <= 0) {
      this.mobileSocketWiring?.terminateCloudSessionConnections(
        socket.principal.managedWebSessionId
      )
      return
    }
    // Bound Node's timer delay and recheck wall time if the clock moves before the deadline.
    const timer = setTimeout(
      () => {
        this.cloudSessionExpiryTimers.delete(socket.ws)
        if (this.revalidateCloudSession(socket)) {
          this.scheduleCloudSessionExpiry(socket)
        }
      },
      Math.min(remaining, 2_147_483_647)
    )
    timer.unref()
    this.cloudSessionExpiryTimers.set(socket.ws, timer)
  }

  protected handleCloudSocketClose(socket: AuthenticatedCloudManagedSocket): void {
    clearTimeout(this.cloudSessionExpiryTimers.get(socket.ws))
    this.cloudSessionExpiryTimers.delete(socket.ws)
    this.abortWebSocketDispatches(socket.ws)
    this.runtime.cleanupSubscriptionsForConnection(socket.connectionId)
    this.runtime.cancelMobileDictationForConnection(socket.connectionId)
    this.binaryMessageRouter.deleteConnection(socket.connectionId)
  }

  protected clearCloudSessionExpiryTimers(): void {
    for (const timer of this.cloudSessionExpiryTimers.values()) {
      clearTimeout(timer)
    }
    this.cloudSessionExpiryTimers.clear()
  }

  protected async handleCloudManagedWebSocketMessage(
    request: RpcRequest,
    reply: (response: string) => void,
    sendBinary: (response: Uint8Array<ArrayBufferLike>) => boolean | void,
    ws: WebSocket | undefined,
    socket: AuthenticatedCloudManagedSocket
  ): Promise<void> {
    const requestEnvelope = request as unknown as Record<string, unknown>
    if (
      ['deviceToken', 'sessionToken', 'authToken'].some((field) =>
        Object.hasOwn(requestEnvelope, field)
      )
    ) {
      reply(
        JSON.stringify(
          this.buildError(
            request.id,
            'unauthorized',
            'Cloud-managed requests must not repeat authentication credentials'
          )
        )
      )
      return
    }

    if (!this.revalidateCloudSession(socket)) {
      reply(
        JSON.stringify(
          this.buildError(
            request.id,
            request.method === 'cloudRuntime.displayMetadata'
              ? 'runtime_display_metadata_binding_invalid'
              : 'unauthorized',
            'Cloud-managed session is expired or revoked'
          )
        )
      )
      return
    }
    if (LOCAL_ONLY_RPC_METHODS.has(request.method)) {
      reply(
        JSON.stringify(
          this.buildError(
            request.id,
            'forbidden',
            `Method '${request.method}' is available only to local clients`
          )
        )
      )
      return
    }

    if (request.method === 'cloudRuntime.displayMetadata') {
      await this.handleDisplayMetadata(request, reply, socket, ws)
      return
    }

    const clientId = `cloud-managed:${socket.principal.managedWebSessionId}`
    const longPoll = classifyRuntimeLongPoll(request)
    const rejection = this.admitLongPoll(longPoll, clientId)
    if (rejection) {
      reply(JSON.stringify(this.buildError(request.id, 'runtime_busy', rejection)))
      return
    }
    const abortRegistration = ws ? this.registerWebSocketDispatchAbort(ws) : null
    try {
      await this.dispatcher.dispatchStreaming(request, reply, {
        authorizeRequest: (method) =>
          this.revalidateCloudSession(socket) && !LOCAL_ONLY_RPC_METHODS.has(method),
        authenticatedCallerFingerprint: fingerprintAuthenticatedPairingCredential(clientId),
        connectionId: socket.connectionId,
        clientId,
        clientKind: 'runtime',
        clientCapabilities: socket.clientCapabilities,
        signal: abortRegistration?.signal,
        sendBinary,
        registerBinaryStreamHandler: (streamId, handler) =>
          this.registerBinaryStreamHandler(socket.connectionId, streamId, handler),
        registerBinaryMessageHandler: (handler) =>
          this.registerBinaryMessageHandler(socket.connectionId, handler)
      })
    } finally {
      abortRegistration?.dispose()
      this.releaseLongPoll(longPoll, clientId)
    }
  }

  private async handleDisplayMetadata(
    request: RpcRequest,
    reply: (response: string) => void,
    socket: AuthenticatedCloudManagedSocket,
    ws: WebSocket | undefined
  ): Promise<void> {
    if (
      !request.params ||
      typeof request.params !== 'object' ||
      Array.isArray(request.params) ||
      Object.keys(request.params).length !== 0
    ) {
      reply(
        JSON.stringify(
          this.buildError(
            request.id,
            'runtime_display_metadata_request_invalid',
            'Expected empty metadata params'
          )
        )
      )
      return
    }
    const abort = ws ? this.registerWebSocketDispatchAbort(ws) : null
    try {
      if (!this.cloudWebLaunchService) {
        throw new HiveRuntimeDisplayMetadataError('runtime_display_metadata_unverifiable')
      }
      const result = await this.cloudWebLaunchService.readDisplayMetadata(
        socket.principal,
        abort?.signal
      )
      if (!this.revalidateCloudSession(socket)) {
        throw new HiveRuntimeDisplayMetadataError('runtime_display_metadata_binding_invalid')
      }
      reply(
        JSON.stringify({
          id: request.id,
          ok: true,
          result,
          _meta: { runtimeId: this.runtime.getRuntimeId() }
        })
      )
    } catch (error) {
      const code =
        error instanceof HiveRuntimeDisplayMetadataError
          ? error.code
          : 'runtime_display_metadata_unverifiable'
      const response = this.buildError(request.id, code, 'Runtime display metadata unavailable')
      if (
        !response.ok &&
        error instanceof HiveRuntimeDisplayMetadataError &&
        error.retryAfterMs != null
      ) {
        response.error.data = { retryAfterMs: error.retryAfterMs }
      }
      reply(JSON.stringify(response))
    } finally {
      abort?.dispose()
    }
  }
}
