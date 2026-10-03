import { RemoteRuntimeClientError } from './remote-runtime-client-error'

const TERMINAL_CLOSE_CODES = new Set([1002, 1009, 4403, 4426])

/** A request reached the socket, but no authoritative reply settled it. */
export class HiveAccountRelayDeliveryUnknownError extends RemoteRuntimeClientError {
  constructor(error: unknown) {
    const remote = error instanceof RemoteRuntimeClientError ? error : null
    super(
      remote?.code ?? 'remote_runtime_unavailable',
      error instanceof Error ? error.message : 'Relay request delivery is unconfirmed',
      remote ?? undefined
    )
    this.name = 'HiveAccountRelayDeliveryUnknownError'
    this.cause = error
  }
}

export function toHiveAccountRelayClientError(error: unknown): RemoteRuntimeClientError {
  if (error instanceof RemoteRuntimeClientError) {
    return error
  }
  const source =
    error && typeof error === 'object'
      ? (error as { status?: unknown; retryAfterMs?: unknown })
      : {}
  const retryable = classifyHiveAccountRelayError(error).retryable
  const status = typeof source.status === 'number' ? source.status : undefined
  const code =
    status === 401 || status === 403
      ? 'unauthorized'
      : status === 426
        ? 'remote_runtime_upgrade_required'
        : retryable
          ? 'remote_runtime_unavailable'
          : 'remote_runtime_connection_rejected'
  const message = retryable
    ? 'Could not connect to the remote HiveCode runtime.'
    : status === 401 || status === 403
      ? 'Account runtime authorization was rejected.'
      : status === 426
        ? 'Runtime client upgrade required.'
        : 'Account runtime connection was rejected.'
  return Object.assign(
    new RemoteRuntimeClientError(code, message, {
      pairingStage: 'connect'
    }),
    {
      retryable,
      ...(status !== undefined ? { status } : {}),
      ...(typeof source.retryAfterMs === 'number' ? { retryAfterMs: source.retryAfterMs } : {})
    }
  )
}

export class HiveAccountRelayClosedError extends RemoteRuntimeClientError {
  readonly retryable: boolean

  constructor(closeCode = 1006) {
    super(
      closeCode === 4426 ? 'remote_runtime_upgrade_required' : 'remote_runtime_unavailable',
      closeCode === 4426 ? 'Runtime client upgrade required' : 'Relay connection closed',
      { closeCode }
    )
    this.name = 'HiveAccountRelayClosedError'
    this.retryable = !TERMINAL_CLOSE_CODES.has(closeCode)
  }
}

/** Transport recovery never replays a submitted operation. */
export function classifyHiveAccountRelayError(
  error: unknown,
  attempt = 0,
  random: () => number = Math.random
): { retryable: boolean; retryDelayMs: number } {
  const details =
    error && typeof error === 'object'
      ? (error as {
          status?: unknown
          closeCode?: unknown
          retryable?: unknown
          retryAfterMs?: unknown
        })
      : {}
  const retryable = !(
    details.retryable === false ||
    (typeof details.closeCode === 'number' && TERMINAL_CLOSE_CODES.has(details.closeCode)) ||
    details.status === 401 ||
    details.status === 403 ||
    details.status === 426
  )
  const limit = Math.min(1_000 * 2 ** Math.min(16, Math.max(0, attempt)), 16_000)
  const jitter = Math.floor(Math.max(0, Math.min(1, random())) * limit)
  const retryAfter =
    details.status === 429 &&
    typeof details.retryAfterMs === 'number' &&
    Number.isFinite(details.retryAfterMs)
      ? Math.max(0, Math.min(60_000, details.retryAfterMs))
      : 0
  return { retryable, retryDelayMs: retryable ? Math.max(jitter, retryAfter) : 0 }
}
