export type RemoteRuntimeClientErrorLike = { code?: string; message: string }

export const RUNTIME_RPC_QUEUE_OVERLOAD_CODE = 'runtime_rpc_queue_overloaded'
export const RUNTIME_RPC_QUEUE_OVERLOAD_MESSAGE_FRAGMENT = 'remote runtime call queue is full'

// Exported so the transport-error corpus guard can name the offending entry when a
// code and its message disagree; see remote-runtime-transport-error-agreement.test.ts.
export const RECOVERABLE_CODES: ReadonlySet<string> = new Set([
  'remote_runtime_unavailable',
  RUNTIME_RPC_QUEUE_OVERLOAD_CODE,
  'runtime_timeout',
  'runtime_unavailable',
  'reconnecting',
  'timeout'
])

export const RECOVERABLE_MESSAGE_FRAGMENTS: readonly string[] = [
  'could not connect to the remote orca runtime',
  'could not connect to the remote hivecode runtime',
  'remote orca runtime closed the connection',
  'remote hivecode runtime closed the connection',
  'remote orca runtime connection closed',
  'remote hivecode runtime connection closed',
  'remote orca runtime is not connected',
  'remote hivecode runtime is not connected',
  RUNTIME_RPC_QUEUE_OVERLOAD_MESSAGE_FRAGMENT,
  'remote runtime connection closed',
  'remote runtime subscription closed before it started',
  'remote terminal stream is not connected',
  'timed out waiting for the remote orca runtime',
  'timed out waiting for the remote hivecode runtime'
]

export function isRuntimeRpcQueueOverloadError(error: RemoteRuntimeClientErrorLike): boolean {
  if (error.code) {
    return error.code === RUNTIME_RPC_QUEUE_OVERLOAD_CODE
  }
  return error.message.toLowerCase().includes(RUNTIME_RPC_QUEUE_OVERLOAD_MESSAGE_FRAGMENT)
}

export function isRecoverableRemoteRuntimeConnectionError(
  error: RemoteRuntimeClientErrorLike
): boolean {
  if (error.code) {
    return RECOVERABLE_CODES.has(error.code)
  }
  const message = error.message.toLowerCase()
  return RECOVERABLE_MESSAGE_FRAGMENTS.some((fragment) => message.includes(fragment))
}

export function toRemoteRuntimeClientErrorLike(error: unknown): RemoteRuntimeClientErrorLike {
  if (error && typeof error === 'object') {
    const candidate = error as { code?: unknown; message?: unknown }
    if (typeof candidate.message === 'string') {
      return {
        ...(typeof candidate.code === 'string' ? { code: candidate.code } : {}),
        message: candidate.message
      }
    }
  }
  return { message: String(error) }
}
