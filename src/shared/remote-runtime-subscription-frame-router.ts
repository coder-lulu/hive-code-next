import type { RuntimeE2EEClientSession } from './runtime-e2ee-client-session'
import type WebSocket from 'ws'
import { APP_DISPLAY_NAME } from './brand'
import {
  classifyRemoteRuntimeReadyFrame,
  parseRemoteRuntimeAuthenticatedFrame,
  type RemoteRuntimeHandshakeState
} from './remote-runtime-client-handshake'
import { RemoteRuntimeClientError } from './remote-runtime-client-error'
import { RuntimeRpcEnvelopeSchema, type RuntimeRpcResponse } from './runtime-rpc-envelope'
import { parseRemoteRuntimeJsonText } from './remote-runtime-request-frames'

type SubscriptionFrameRouterOptions<TResult> = {
  session: RuntimeE2EEClientSession
  serializedAuth: string
  serializedRequest: string
  requestId: string
  send: (frame: string) => void
  fail: (error: RemoteRuntimeClientError) => void
  onAuthenticated: () => void
  // Responses to requests the caller sent over this same socket; unmatched ids stay a hard failure.
  resolvePendingRequest?: (response: RuntimeRpcResponse<unknown>) => boolean
  callbacks: {
    onResponse: (response: RuntimeRpcResponse<TResult>) => void
    onBinary?: (bytes: Uint8Array<ArrayBufferLike>) => void
  }
}

export class RemoteRuntimeSubscriptionFrameRouter<TResult> {
  state: RemoteRuntimeHandshakeState = 'awaiting_ready'

  constructor(private readonly options: SubscriptionFrameRouterOptions<TResult>) {}

  handleFrame(data: WebSocket.RawData, isBinary: boolean): void {
    if (isBinary) {
      this.handleBinaryFrame(new Uint8Array(data as Buffer))
      return
    }
    const frame = data.toString()
    if (this.state === 'awaiting_ready') {
      this.handleReadyFrame(frame)
      return
    }
    const plaintext = this.options.session.openText(frame)
    if (plaintext === null) {
      this.options.fail(
        new RemoteRuntimeClientError(
          'invalid_runtime_response',
          `Remote ${APP_DISPLAY_NAME} runtime returned an undecryptable frame.`
        )
      )
      return
    }
    if (this.state === 'awaiting_authenticated') {
      this.handleAuthenticatedFrame(plaintext)
      return
    }
    this.handleRpcFrame(plaintext)
  }

  private handleReadyFrame(frame: string): void {
    const readyFrame = classifyRemoteRuntimeReadyFrame(frame, this.options.session)
    if (readyFrame !== 'ready') {
      this.options.fail(
        new RemoteRuntimeClientError(
          'invalid_runtime_response',
          readyFrame === 'invalid'
            ? `Remote ${APP_DISPLAY_NAME} runtime returned an invalid E2EE handshake frame.`
            : `Remote ${APP_DISPLAY_NAME} runtime returned an unexpected E2EE handshake frame.`
        )
      )
      return
    }
    this.state = 'awaiting_authenticated'
    this.options.send(
      this.options.session.sealText(
        JSON.stringify({
          ...JSON.parse(this.options.serializedAuth),
          v: 2,
          transcriptHashB64: this.options.session.transcriptHashB64
        })
      )
    )
  }

  private handleAuthenticatedFrame(plaintext: string): void {
    const authenticated = parseRemoteRuntimeAuthenticatedFrame(plaintext, this.options.session)
    if (authenticated.kind === 'invalid') {
      this.options.fail(
        new RemoteRuntimeClientError(
          'invalid_runtime_response',
          `Remote ${APP_DISPLAY_NAME} runtime returned an invalid E2EE auth frame.`
        )
      )
      return
    }
    if (authenticated.kind !== 'authenticated') {
      const code = authenticated.unauthorized ? 'unauthorized' : 'invalid_runtime_response'
      this.options.fail(
        new RemoteRuntimeClientError(
          code,
          `Remote ${APP_DISPLAY_NAME} runtime rejected the pairing token.`
        )
      )
      return
    }
    this.state = 'ready'
    this.options.send(this.options.session.sealText(this.options.serializedRequest))
    this.options.onAuthenticated()
  }

  private handleRpcFrame(plaintext: string): void {
    let raw: unknown
    try {
      raw = parseRemoteRuntimeJsonText(plaintext)
    } catch {
      this.options.fail(
        new RemoteRuntimeClientError(
          'invalid_runtime_response',
          `Remote ${APP_DISPLAY_NAME} runtime returned an invalid response frame.`
        )
      )
      return
    }
    const parsed = RuntimeRpcEnvelopeSchema.safeParse(raw)
    if (!parsed.success || '_keepalive' in parsed.data) {
      return
    }
    const response = parsed.data as RuntimeRpcResponse<TResult>
    if (response.id === this.options.requestId) {
      this.deliver(() => this.options.callbacks.onResponse(response))
      return
    }
    if (this.options.resolvePendingRequest?.(response as RuntimeRpcResponse<unknown>)) {
      return
    }
    this.options.fail(
      new RemoteRuntimeClientError(
        'invalid_runtime_response',
        `Remote ${APP_DISPLAY_NAME} runtime returned a mismatched response id.`
      )
    )
  }

  private handleBinaryFrame(frame: Uint8Array<ArrayBufferLike>): void {
    if (this.state !== 'ready') {
      this.options.fail(
        new RemoteRuntimeClientError(
          'invalid_runtime_response',
          `Remote ${APP_DISPLAY_NAME} runtime returned binary data before authentication.`
        )
      )
      return
    }
    const plaintext = this.options.session.openBinary(frame)
    if (plaintext === null) {
      this.options.fail(
        new RemoteRuntimeClientError(
          'invalid_runtime_response',
          `Remote ${APP_DISPLAY_NAME} runtime returned an undecryptable binary frame.`
        )
      )
      return
    }
    this.deliver(() => this.options.callbacks.onBinary?.(plaintext))
  }

  // Why: `handleFrame` runs straight off the ws 'message' emitter, so a consumer throw becomes an
  // uncaught exception that kills the process. The request router already routes one to
  // `finishError`; mirror that here rather than leaving the subscription path unguarded.
  private deliver(emit: () => void): void {
    try {
      emit()
    } catch (error) {
      this.options.fail(
        error instanceof RemoteRuntimeClientError
          ? error
          : new RemoteRuntimeClientError(
              'runtime_error',
              error instanceof Error ? error.message : String(error)
            )
      )
    }
  }
}
